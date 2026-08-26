const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapAngle(value) {
  let result = value % TAU;
  if (result > Math.PI) result -= TAU;
  if (result < -Math.PI) result += TAU;
  return result;
}

function shortestAngle(from, to) {
  return wrapAngle(to - from);
}

function easeOutCubic(value) {
  return 1 - ((1 - value) ** 3);
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`全景着色器编译失败：${error}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`全景程序链接失败：${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

export class PanoramaRoom {
  constructor({
    stage,
    canvas,
    hotspotLayer,
    imageUrl,
    hotspots,
    defaultView,
    initialView = defaultView,
    interactionEnabled = true,
    groups = {},
    onActivate,
    onThought,
  }) {
    this.stage = stage;
    this.canvas = canvas;
    this.hotspotLayer = hotspotLayer;
    this.imageUrl = imageUrl;
    this.hotspots = hotspots;
    this.defaultView = { ...defaultView };
    this.groups = groups;
    this.onActivate = onActivate;
    this.onThought = onThought;
    this.view = { ...initialView };
    this.idleView = { ...defaultView };
    this.hotspotElements = new Map();
    this.pointer = null;
    this.animation = null;
    this.reducedMotion = false;
    this.renderRequested = false;
    this.ready = false;
    this.destroyed = false;
    this.interactionEnabled = Boolean(interactionEnabled);
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    this.createHotspots();
    this.bindEvents();
    this.setInteractionEnabled(this.interactionEnabled);
    this.initRenderer();
  }

  finishReady(detail) {
    if (!this.resolveReady) return;
    this.resolveReady(detail);
    this.resolveReady = null;
  }

  whenReady() {
    return this.readyPromise;
  }

  initRenderer() {
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    }) || this.canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      this.stage.classList.add('is-static-fallback');
      this.stage.style.setProperty('--panorama-image', `url("${this.imageUrl}")`);
      const message = '浏览器不支持 WebGL，已显示静态场景。';
      this.stage.dispatchEvent(new CustomEvent('panoramaerror', { detail: message }));
      this.finishReady({ fallback: true, message });
      this.projectHotspots();
      return;
    }

    this.gl = gl;
    const vertexSource = `
      attribute vec2 aPosition;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;
    const fragmentSource = `
      precision highp float;
      uniform vec2 uResolution;
      uniform float uYaw;
      uniform float uPitch;
      uniform float uFov;
      uniform sampler2D uPanorama;
      const float PI = 3.141592653589793;

      mat3 rotateY(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
      }

      mat3 rotateX(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
      }

      void main() {
        vec2 centered = (gl_FragCoord.xy * 2.0 - uResolution) / uResolution.y;
        float focal = 1.0 / tan(uFov * 0.5);
        vec3 ray = normalize(vec3(centered.x, centered.y, -focal));
        ray = rotateY(uYaw) * rotateX(uPitch) * ray;
        float longitude = atan(ray.x, -ray.z);
        float latitude = asin(clamp(ray.y, -1.0, 1.0));
        vec2 uv = vec2(fract(0.5 + longitude / (2.0 * PI)), 0.5 - latitude / PI);
        gl_FragColor = texture2D(uPanorama, uv);
      }
    `;

    try {
      this.program = createProgram(gl, vertexSource, fragmentSource);
      gl.useProgram(this.program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(this.program, 'aPosition');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      this.uniforms = {
        resolution: gl.getUniformLocation(this.program, 'uResolution'),
        yaw: gl.getUniformLocation(this.program, 'uYaw'),
        pitch: gl.getUniformLocation(this.program, 'uPitch'),
        fov: gl.getUniformLocation(this.program, 'uFov'),
      };
      this.loadTexture();
    } catch (error) {
      console.error(error);
      this.stage.classList.add('is-static-fallback');
      this.stage.style.setProperty('--panorama-image', `url("${this.imageUrl}")`);
      this.stage.dispatchEvent(new CustomEvent('panoramaerror', { detail: error.message }));
      this.finishReady({ fallback: true, message: error.message });
    }
  }

  loadTexture() {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (this.destroyed) return;
      const gl = this.gl;
      const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      let source = image;
      if (image.width > maxSize || image.height > maxSize) {
        const scale = Math.min(maxSize / image.width, maxSize / image.height);
        const resized = document.createElement('canvas');
        resized.width = Math.floor(image.width * scale);
        resized.height = Math.floor(image.height * scale);
        resized.getContext('2d').drawImage(image, 0, 0, resized.width, resized.height);
        source = resized;
      }
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.texture = texture;
      this.ready = true;
      this.stage.classList.add('is-ready');
      this.stage.dispatchEvent(new CustomEvent('panoramaready'));
      this.finishReady({ fallback: false, message: '全景已就绪' });
      this.requestRender();
    };
    image.onerror = () => {
      const message = '全景图片加载失败，文字导航仍可使用。';
      this.stage.classList.add('is-static-fallback', 'is-image-missing');
      this.stage.dispatchEvent(new CustomEvent('panoramaerror', { detail: message }));
      this.finishReady({ fallback: true, message });
    };
    image.src = this.imageUrl;
  }

  createHotspots() {
    for (const hotspot of this.hotspots) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `scene-hotspot is-${hotspot.kind}`;
      button.dataset.hotspotId = hotspot.id;
      if (hotspot.panel) button.dataset.open = hotspot.panel;
      if (hotspot.group) button.dataset.group = hotspot.group;
      button.style.setProperty('--hotspot-accent', hotspot.accent || '#d7ff43');

      if (hotspot.kind === 'feature') {
        button.setAttribute('aria-label', `${hotspot.label}：${hotspot.description}`);
        button.innerHTML = `
          <span class="hotspot-orbit" aria-hidden="true"><i></i></span>
          <span class="hotspot-card">
            <small>${hotspot.index} / ${hotspot.eyebrow}</small>
            <strong>${hotspot.label}</strong>
            <em>${hotspot.description}</em>
            ${hotspot.statusId ? `<span id="${hotspot.statusId}"></span>` : ''}
          </span>
          ${hotspot.badgeId ? `<b class="hotspot-badge" id="${hotspot.badgeId}" hidden>0</b>` : ''}`;
      } else {
        button.setAttribute('aria-label', `${hotspot.label}：${hotspot.thought}`);
        button.innerHTML = `
          <span class="package-dot" aria-hidden="true"></span>
          <span class="package-thought"><small>INNER OS</small>${hotspot.thought}</span>`;
      }

      button.addEventListener('click', (event) => {
        if (!this.interactionEnabled) return;
        event.stopPropagation();
        if (hotspot.kind === 'thought') {
          this.hotspotLayer.querySelectorAll('.scene-hotspot.is-thought.is-revealed').forEach((element) => {
            if (element !== button) element.classList.remove('is-revealed');
          });
          button.classList.toggle('is-revealed');
          this.onThought?.(hotspot, button);
          return;
        }
        this.onActivate?.(hotspot, button);
      });
      button.addEventListener('pointerenter', () => {
        if (!this.interactionEnabled) return;
        if (hotspot.kind === 'thought') this.onThought?.(hotspot, button, { preview: true });
      });
      this.hotspotLayer.appendChild(button);
      this.hotspotElements.set(hotspot.id, button);
    }
  }

  bindEvents() {
    this.onPointerDown = (event) => {
      if (!this.interactionEnabled) return;
      if (event.button !== 0 || event.target.closest('button, a, input, select')) return;
      this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      this.stage.setPointerCapture?.(event.pointerId);
      this.stage.classList.add('is-dragging');
      this.animation = null;
    };
    this.onPointerMove = (event) => {
      if (!this.interactionEnabled) return;
      if (!this.pointer || this.pointer.id !== event.pointerId) return;
      const dx = event.clientX - this.pointer.x;
      const dy = event.clientY - this.pointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.pointer.moved = true;
      const radiansPerPixel = this.view.fov / Math.max(300, this.stage.clientHeight);
      // Direct manipulation: the panorama follows the pointer horizontally.
      this.view.yaw = wrapAngle(this.view.yaw + dx * radiansPerPixel);
      this.view.pitch = clamp(this.view.pitch + dy * radiansPerPixel, -0.56, 0.4);
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.idleView = { ...this.view };
      this.requestRender();
    };
    this.onPointerUp = (event) => {
      if (!this.pointer || this.pointer.id !== event.pointerId) return;
      this.pointer = null;
      this.stage.classList.remove('is-dragging');
    };
    this.onWheel = (event) => {
      if (!this.interactionEnabled) return;
      if (event.target.closest('button, a')) return;
      event.preventDefault();
      this.animation = null;
      this.view.fov = clamp(this.view.fov + event.deltaY * 0.0008, 0.55, 1.35);
      this.idleView = { ...this.view };
      this.requestRender();
    };
    this.onKeyDown = (event) => {
      if (!this.interactionEnabled) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(event.key)) return;
      event.preventDefault();
      const turn = 0.12;
      if (event.key === 'ArrowLeft') this.view.yaw = wrapAngle(this.view.yaw - turn);
      if (event.key === 'ArrowRight') this.view.yaw = wrapAngle(this.view.yaw + turn);
      if (event.key === 'ArrowUp') this.view.pitch = clamp(this.view.pitch + turn * 0.6, -0.56, 0.4);
      if (event.key === 'ArrowDown') this.view.pitch = clamp(this.view.pitch - turn * 0.6, -0.56, 0.4);
      if (event.key === '+' || event.key === '=') this.view.fov = clamp(this.view.fov - 0.08, 0.55, 1.35);
      if (event.key === '-') this.view.fov = clamp(this.view.fov + 0.08, 0.55, 1.35);
      this.idleView = { ...this.view };
      this.requestRender();
    };
    this.onVisibilityChange = () => {
      if (!document.hidden) this.requestRender();
    };

    this.stage.addEventListener('pointerdown', this.onPointerDown);
    this.stage.addEventListener('pointermove', this.onPointerMove);
    this.stage.addEventListener('pointerup', this.onPointerUp);
    this.stage.addEventListener('pointercancel', this.onPointerUp);
    this.stage.addEventListener('wheel', this.onWheel, { passive: false });
    this.stage.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.resizeObserver = new ResizeObserver(() => this.requestRender());
    this.resizeObserver.observe(this.stage);
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
  }

  setInteractionEnabled(value) {
    this.interactionEnabled = Boolean(value);
    this.hotspotLayer.inert = !this.interactionEnabled;
    this.stage.classList.toggle('is-interaction-locked', !this.interactionEnabled);
    if (!this.interactionEnabled) {
      this.pointer = null;
      this.stage.classList.remove('is-dragging');
    }
  }

  getTriggerForPanel(panel) {
    const hotspot = this.hotspots.find((item) => item.panel === panel || item.panels?.includes(panel));
    return hotspot ? this.hotspotElements.get(hotspot.id) : null;
  }

  focusPanel(panel) {
    const hotspot = this.hotspots.find((item) => item.panel === panel || item.panels?.includes(panel));
    if (!hotspot) return;
    this.focusHotspot(hotspot.id);
  }

  focusHotspot(id) {
    const hotspot = this.hotspots.find((item) => item.id === id);
    if (!hotspot) return;
    this.hotspotElements.forEach((element, elementId) => element.classList.toggle('is-active', elementId === id));
    this.animateTo(hotspot.focus || { yaw: hotspot.yaw, pitch: hotspot.pitch, fov: 0.8 });
  }

  focusGroup(id) {
    const group = this.groups[id];
    if (!group) return;
    this.hotspotElements.forEach((element) => element.classList.toggle('is-group-active', element.dataset.group === id));
    this.animateTo(group.focus);
  }

  resetView() {
    this.hotspotElements.forEach((element) => element.classList.remove('is-active', 'is-group-active', 'is-revealed'));
    this.animateTo(this.idleView || this.defaultView);
  }

  animateTo(target, { duration = 520, updateIdle = false } = {}) {
    if (this.animation?.resolve) this.animation.resolve(false);
    if (updateIdle) this.idleView = { ...target };
    if (this.reducedMotion) {
      this.view = { ...target };
      this.animation = null;
      this.requestRender();
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      this.animation = {
        startedAt: performance.now(),
        duration,
        from: { ...this.view },
        to: { ...target },
        resolve,
      };
      this.requestRender();
    });
  }

  animateToView(target, options = {}) {
    return this.animateTo(target, options);
  }

  requestRender() {
    if (this.renderRequested || document.hidden || this.destroyed) return;
    this.renderRequested = true;
    requestAnimationFrame((time) => {
      this.renderRequested = false;
      this.render(time);
    });
  }

  render(time) {
    if (this.animation) {
      const progress = clamp((time - this.animation.startedAt) / this.animation.duration, 0, 1);
      const eased = easeOutCubic(progress);
      this.view.yaw = wrapAngle(this.animation.from.yaw + shortestAngle(this.animation.from.yaw, this.animation.to.yaw) * eased);
      this.view.pitch = this.animation.from.pitch + (this.animation.to.pitch - this.animation.from.pitch) * eased;
      this.view.fov = this.animation.from.fov + (this.animation.to.fov - this.animation.from.fov) * eased;
      if (progress >= 1) {
        const completed = this.animation;
        this.animation = null;
        completed.resolve?.(true);
      }
    }

    if (this.gl && this.ready) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(this.stage.clientWidth * dpr));
      const height = Math.max(1, Math.round(this.stage.clientHeight * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      const gl = this.gl;
      gl.viewport(0, 0, width, height);
      gl.useProgram(this.program);
      gl.uniform2f(this.uniforms.resolution, width, height);
      gl.uniform1f(this.uniforms.yaw, this.view.yaw);
      gl.uniform1f(this.uniforms.pitch, this.view.pitch);
      gl.uniform1f(this.uniforms.fov, this.view.fov);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    this.projectHotspots();
    if (this.animation) this.requestRender();
  }

  projectHotspots() {
    const width = this.stage.clientWidth || 1;
    const height = this.stage.clientHeight || 1;
    const aspect = width / height;
    const forward = {
      x: -Math.sin(this.view.yaw) * Math.cos(this.view.pitch),
      y: Math.sin(this.view.pitch),
      z: -Math.cos(this.view.yaw) * Math.cos(this.view.pitch),
    };
    const right = { x: Math.cos(this.view.yaw), y: 0, z: -Math.sin(this.view.yaw) };
    const up = cross(right, forward);
    const tanHalfFov = Math.tan(this.view.fov / 2);

    for (const hotspot of this.hotspots) {
      const element = this.hotspotElements.get(hotspot.id);
      const world = {
        x: -Math.sin(hotspot.yaw) * Math.cos(hotspot.pitch),
        y: Math.sin(hotspot.pitch),
        z: -Math.cos(hotspot.yaw) * Math.cos(hotspot.pitch),
      };
      const localX = dot(world, right);
      const localY = dot(world, up);
      const localZ = dot(world, forward);
      const ndcX = localX / (Math.max(localZ, 0.001) * tanHalfFov * aspect);
      const ndcY = localY / (Math.max(localZ, 0.001) * tanHalfFov);
      const visible = localZ > 0.05 && Math.abs(ndcX) < 1.14 && Math.abs(ndcY) < 1.18;
      element.hidden = !visible;
      if (!visible) continue;
      element.style.left = `${(ndcX * 0.5 + 0.5) * width}px`;
      element.style.top = `${(-ndcY * 0.5 + 0.5) * height}px`;
      element.style.setProperty('--depth-scale', clamp(0.78 + localZ * 0.24, 0.82, 1.05).toFixed(3));
    }
  }
}
