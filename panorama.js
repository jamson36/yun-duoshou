const TAU = Math.PI * 2;
const DEFAULT_SOURCE_ASPECT = 2;
const DESKTOP_MIN_WIDTH = 821;
const DESKTOP_STAGE_ASPECT = 16 / 9;
const SPHERICAL_MAX_FOV = Math.PI / 2;

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

function wrapUnit(value) {
  let result = value % 1;
  if (result > 0.5) result -= 1;
  if (result < -0.5) result += 1;
  return result;
}

export function canManipulatePanorama({ interactionEnabled, reducedMotion }) {
  return Boolean(interactionEnabled) && !Boolean(reducedMotion);
}

export function canActivateHotspotKind(kind) {
  return kind === 'feature' || kind === 'activity';
}

function easeOutCubic(value) {
  return 1 - ((1 - value) ** 3);
}

function normalizeHotspotAsset(asset) {
  if (!asset || typeof asset.src !== 'string' || !asset.src.trim()) return null;
  const width = Math.round(Number(asset.width));
  const height = Math.round(Number(asset.height));
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
  return {
    src: asset.src,
    width,
    height,
    nodeId: typeof asset.nodeId === 'string' ? asset.nodeId : '',
  };
}

export function renderFeatureHotspotMarkup(hotspot) {
  const asset = normalizeHotspotAsset(hotspot.asset);
  const assetMarkup = asset ? `
    <span class="hotspot-asset" aria-hidden="true"${asset.nodeId ? ` data-figma-node-id="${asset.nodeId}"` : ''}>
      <span class="hotspot-asset-bubble"></span>
      <span class="hotspot-asset-icon">
        <img src="${asset.src}" alt="" width="${asset.width}" height="${asset.height}" decoding="async" draggable="false" />
      </span>
      <strong class="hotspot-asset-label">${hotspot.label}</strong>
    </span>` : '';

  return `${assetMarkup}
    <span class="hotspot-fallback">
      <span class="hotspot-orbit" aria-hidden="true"><i></i></span>
      <span class="hotspot-card">
        <small>${hotspot.index} / ${hotspot.eyebrow}</small>
        <strong>${hotspot.label}</strong>
        <em>${hotspot.description}</em>
        ${hotspot.statusId ? `<span id="${hotspot.statusId}"></span>` : ''}
      </span>
    </span>
    ${hotspot.badgeId ? `<b class="hotspot-badge" id="${hotspot.badgeId}" hidden>0</b>` : ''}`;
}

export function renderActivityHotspotMarkup(hotspot) {
  return `
    <span class="activity-hotspot-device" aria-hidden="true">
      <span class="activity-hotspot-screen"><i></i><b></b></span>
      <span class="activity-hotspot-controls is-left"><i></i></span>
      <span class="activity-hotspot-controls is-right"><i></i><i></i></span>
    </span>
    <span class="activity-hotspot-copy" aria-hidden="true">
      <small>小游戏</small>
      <strong>${hotspot.label}</strong>
    </span>`;
}

export function projectedHotspotFitsViewport(point, frame, hotspot) {
  if (!point?.visible) return false;
  const asset = hotspot?.kind === 'feature' ? normalizeHotspotAsset(hotspot.asset) : null;
  if (!asset) return true;

  // Feature labels are centered on their authored point. Keep the complete
  // label inside the stage instead of exposing a clipped half-label at the
  // edge while the user pans the room. The top text navigation remains the
  // always-available equivalent entry while a spatial label is off-screen.
  const horizontalMargin = Math.min(asset.width / 2, frame.width / 4);
  const verticalMargin = Math.min(asset.height / 2, frame.height / 4);
  return point.x >= horizontalMargin
    && point.x <= frame.width - horizontalMargin
    && point.y >= verticalMargin
    && point.y <= frame.height - verticalMargin;
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

export function computeFlatProjectionFrame({
  width,
  height,
  sourceAspect = DEFAULT_SOURCE_ASPECT,
  view,
  defaultFov,
}) {
  const safeWidth = Math.max(1, width || 1);
  const safeHeight = Math.max(1, height || 1);
  const safeSourceAspect = Math.max(0.01, sourceAspect || DEFAULT_SOURCE_ASPECT);
  const viewportAspect = safeWidth / safeHeight;
  const useDesktopStage = safeWidth >= DESKTOP_MIN_WIDTH;
  let contentWidth = safeWidth;
  let contentHeight = safeHeight;

  if (useDesktopStage && viewportAspect < DESKTOP_STAGE_ASPECT) {
    contentHeight = safeWidth / DESKTOP_STAGE_ASPECT;
  } else if (useDesktopStage && viewportAspect > DESKTOP_STAGE_ASPECT) {
    contentWidth = safeHeight * DESKTOP_STAGE_ASPECT;
  }

  const contentX = (safeWidth - contentWidth) / 2;
  const contentY = (safeHeight - contentHeight) / 2;
  const contentAspect = contentWidth / contentHeight;
  const baseSpanU = Math.min(1, contentAspect / safeSourceAspect);
  const baseSpanV = Math.min(1, safeSourceAspect / contentAspect);
  // Cover is the widest valid flat view. Capping here avoids stretching one
  // axis after the first source edge has already reached the viewport edge.
  const zoom = clamp(view.fov / Math.max(defaultFov, 0.01), 0.2, 1);
  const spanU = Math.min(1, baseSpanU * zoom);
  const spanV = Math.min(1, baseSpanV * zoom);
  const requestedCenterV = 0.5 - view.pitch / Math.PI;

  return {
    width: safeWidth,
    height: safeHeight,
    aspect: viewportAspect,
    contentX,
    contentY,
    contentWidth,
    contentHeight,
    contentAspect,
    spanU,
    spanV,
    centerU: 0.5 - view.yaw / TAU,
    centerV: clamp(requestedCenterV, spanV / 2, 1 - spanV / 2),
  };
}

export function projectFlatPoint(yaw, pitch, frame) {
  const sourceU = 0.5 - yaw / TAU;
  const sourceV = 0.5 - pitch / Math.PI;
  const deltaU = wrapUnit(sourceU - frame.centerU);
  const deltaV = sourceV - frame.centerV;
  const ndcX = deltaU / (frame.spanU / 2);
  const ndcY = -deltaV / (frame.spanV / 2);
  const visible = Math.abs(ndcX) < 1.14
    && Math.abs(ndcY) < 1.18
    && sourceV >= 0
    && sourceV <= 1;

  return {
    x: frame.contentX + (ndcX * 0.5 + 0.5) * frame.contentWidth,
    y: frame.contentY + (-ndcY * 0.5 + 0.5) * frame.contentHeight,
    ndcX,
    ndcY,
    localZ: visible ? 1 : 0,
    depthScale: 1,
    visible,
  };
}

export function unprojectFlatPoint(screenX, screenY, frame) {
  const localX = (screenX - frame.contentX) / frame.contentWidth;
  const localY = (screenY - frame.contentY) / frame.contentHeight;
  const sourceU = frame.centerU + (localX - 0.5) * frame.spanU;
  const sourceV = frame.centerV + (localY - 0.5) * frame.spanV;
  return {
    yaw: wrapAngle((0.5 - sourceU) * TAU),
    pitch: clamp((0.5 - sourceV) * Math.PI, -Math.PI / 2, Math.PI / 2),
  };
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
    projection = 'flat',
    interactionEnabled = true,
    groups = {},
    onActivate,
    onThought,
  }) {
    this.stage = stage;
    this.stageInteractionLabel = stage.getAttribute?.('aria-label') || '';
    this.canvas = canvas;
    this.hotspotLayer = hotspotLayer;
    this.imageUrl = imageUrl;
    this.hotspots = hotspots;
    this.defaultView = { ...defaultView };
    this.projection = projection === 'spherical' ? 'spherical' : 'flat';
    this.sourceAspect = DEFAULT_SOURCE_ASPECT;
    this.groups = groups;
    this.onActivate = onActivate;
    this.onThought = onThought;
    this.view = { ...initialView };
    this.idleView = { ...defaultView };
    this.hotspotElements = new Map();
    this.projectionObservers = new Set();
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
      uniform float uProjection;
      uniform vec2 uFlatCenter;
      uniform vec2 uFlatSpan;
      uniform vec4 uFlatRect;
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
        if (uProjection > 0.5) {
          vec2 rawScreenUv = (gl_FragCoord.xy - uFlatRect.xy) / uFlatRect.zw;
          vec2 screenUv = clamp(rawScreenUv, 0.0, 1.0);
          vec2 uv = vec2(
            fract(uFlatCenter.x + (screenUv.x - 0.5) * uFlatSpan.x),
            clamp(uFlatCenter.y + (0.5 - screenUv.y) * uFlatSpan.y, 0.0, 1.0)
          );
          vec4 roomColor = texture2D(uPanorama, uv);
          float outsideDistance = max(
            max(-rawScreenUv.x, rawScreenUv.x - 1.0),
            max(-rawScreenUv.y, rawScreenUv.y - 1.0)
          );
          if (outsideDistance > 0.0) {
            vec3 topFill = vec3(0.72, 0.45, 0.25);
            vec3 bottomFill = vec3(0.95, 0.69, 0.42);
            vec3 outsideFill = rawScreenUv.y > 1.0 ? topFill : bottomFill;
            float edgeBlend = 1.0 - smoothstep(0.0, 0.025, outsideDistance);
            roomColor.rgb = mix(outsideFill, roomColor.rgb, edgeBlend);
          }
          gl_FragColor = roomColor;
          return;
        }
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
        projection: gl.getUniformLocation(this.program, 'uProjection'),
        flatCenter: gl.getUniformLocation(this.program, 'uFlatCenter'),
        flatSpan: gl.getUniformLocation(this.program, 'uFlatSpan'),
        flatRect: gl.getUniformLocation(this.program, 'uFlatRect'),
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
      this.sourceAspect = image.width / image.height;
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
        const asset = normalizeHotspotAsset(hotspot.asset);
        if (asset) {
          button.classList.add('has-hotspot-asset');
          button.style.setProperty('--hotspot-asset-width', `${asset.width}px`);
          button.style.setProperty('--hotspot-asset-height', `${asset.height}px`);
        }
        button.innerHTML = renderFeatureHotspotMarkup(hotspot);

        const assetImage = button.querySelector('.hotspot-asset img');
        if (assetImage) {
          const markAssetReady = () => {
            button.classList.add('is-hotspot-asset-ready');
            button.classList.remove('is-hotspot-asset-failed');
          };
          const markAssetFailed = () => {
            button.classList.remove('is-hotspot-asset-ready');
            button.classList.add('is-hotspot-asset-failed');
          };
          assetImage.addEventListener('load', markAssetReady, { once: true });
          assetImage.addEventListener('error', markAssetFailed, { once: true });
          if (assetImage.complete) {
            if (assetImage.naturalWidth > 0) markAssetReady();
            else markAssetFailed();
          }
        }
      } else if (hotspot.kind === 'activity') {
        button.dataset.activity = hotspot.activity;
        button.setAttribute('aria-label', `${hotspot.label}：${hotspot.description}`);
        button.innerHTML = renderActivityHotspotMarkup(hotspot);
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
      if (!canManipulatePanorama(this)) return;
      if (event.button !== 0 || event.target.closest('button, a, input, select')) return;
      this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      this.stage.setPointerCapture?.(event.pointerId);
      this.stage.classList.add('is-dragging');
      this.animation = null;
    };
    this.onPointerMove = (event) => {
      if (!canManipulatePanorama(this)) return;
      if (!this.pointer || this.pointer.id !== event.pointerId) return;
      const dx = event.clientX - this.pointer.x;
      const dy = event.clientY - this.pointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.pointer.moved = true;
      this.applyInputDelta({ panX: dx, panY: dy });
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
    };
    this.onPointerUp = (event) => {
      if (!this.pointer || this.pointer.id !== event.pointerId) return;
      this.pointer = null;
      this.stage.classList.remove('is-dragging');
    };
    this.onWheel = (event) => {
      if (!canManipulatePanorama(this)) return;
      if (event.target.closest('button, a')) return;
      event.preventDefault();
      this.applyInputDelta({ zoomDelta: event.deltaY * 0.0008 });
    };
    this.onKeyDown = (event) => {
      if (!canManipulatePanorama(this)) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(event.key)) return;
      event.preventDefault();
      const turn = 0.12;
      const radiansPerPixel = this.view.fov / Math.max(300, this.stage.clientHeight);
      this.applyInputDelta({
        panX: event.key === 'ArrowLeft'
          ? -turn / radiansPerPixel
          : event.key === 'ArrowRight'
            ? turn / radiansPerPixel
            : 0,
        panY: event.key === 'ArrowUp'
          ? (turn * 0.6) / radiansPerPixel
          : event.key === 'ArrowDown'
            ? (-turn * 0.6) / radiansPerPixel
            : 0,
        zoomDelta: event.key === '+' || event.key === '=' ? -0.08 : event.key === '-' ? 0.08 : 0,
      });
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

  applyInputDelta({ panX = 0, panY = 0, zoomDelta = 0 } = {}) {
    if (!canManipulatePanorama(this)) return false;
    const safePanX = Number.isFinite(Number(panX)) ? Number(panX) : 0;
    const safePanY = Number.isFinite(Number(panY)) ? Number(panY) : 0;
    const safeZoomDelta = Number.isFinite(Number(zoomDelta)) ? Number(zoomDelta) : 0;
    const radiansPerPixel = this.view.fov / Math.max(300, this.stage.clientHeight);
    return PanoramaRoom.prototype.applyAngularInputDelta.call(this, {
      yawDelta: safePanX * radiansPerPixel,
      pitchDelta: safePanY * radiansPerPixel,
      zoomDelta: safeZoomDelta,
    });
  }

  applyAngularInputDelta({ yawDelta = 0, pitchDelta = 0, zoomDelta = 0 } = {}) {
    if (!canManipulatePanorama(this)) return false;
    const safeYawDelta = Number.isFinite(Number(yawDelta)) ? Number(yawDelta) : 0;
    const safePitchDelta = Number.isFinite(Number(pitchDelta)) ? Number(pitchDelta) : 0;
    const safeZoomDelta = Number.isFinite(Number(zoomDelta)) ? Number(zoomDelta) : 0;
    const interruptedAnimation = this.animation;
    this.animation = null;
    interruptedAnimation?.resolve?.(false);
    // Direct manipulation: every controller makes the panorama follow the input.
    this.view.yaw = wrapAngle(this.view.yaw + safeYawDelta);
    this.view.pitch = clamp(this.view.pitch + safePitchDelta, -0.56, 0.4);
    const maxFov = this.projection === 'flat' ? this.defaultView.fov : SPHERICAL_MAX_FOV;
    this.view.fov = clamp(this.view.fov + safeZoomDelta, 0.55, maxFov);
    this.idleView = { ...this.view };
    this.requestRender();
    return true;
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
    this.stage.classList.toggle('is-reduced-motion', this.reducedMotion);
    this.stage.setAttribute?.(
      'aria-label',
      this.reducedMotion
        ? '钱包全景房间。已减少动态，请使用下方三个文字入口。'
        : this.stageInteractionLabel,
    );
    if (!this.reducedMotion) return;
    const interruptedAnimation = this.animation;
    this.animation = null;
    interruptedAnimation?.resolve?.(false);
    this.pointer = null;
    this.stage.classList.remove('is-dragging');
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

  hotspotAtPoint(point) {
    if (!this.interactionEnabled || !point) return null;
    const localX = Number(point.x);
    const localY = Number(point.y);
    if (!Number.isFinite(localX) || !Number.isFinite(localY)) return null;
    const stageRect = this.stage.getBoundingClientRect();
    const clientX = stageRect.left + localX;
    const clientY = stageRect.top + localY;

    for (const hotspot of this.hotspots) {
      if (!canActivateHotspotKind(hotspot.kind)) continue;
      const element = this.hotspotElements.get(hotspot.id);
      if (!element || element.hidden || element.disabled) continue;
      const rect = element.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return hotspot.id;
      }
    }
    return null;
  }

  activateHotspot(id) {
    if (!this.interactionEnabled) return false;
    const hotspot = this.hotspots.find((item) => item.id === id && canActivateHotspotKind(item.kind));
    const element = hotspot ? this.hotspotElements.get(hotspot.id) : null;
    if (!element || element.hidden || element.disabled) return false;
    element.click();
    return true;
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
    if (this.reducedMotion) return;
    this.animateTo(hotspot.focus || { yaw: hotspot.yaw, pitch: hotspot.pitch, fov: 0.8 });
  }

  focusGroup(id) {
    const group = this.groups[id];
    if (!group) return;
    this.hotspotElements.forEach((element) => element.classList.toggle('is-group-active', element.dataset.group === id));
    if (this.reducedMotion) return;
    this.animateTo(group.focus);
  }

  resetView() {
    this.hotspotElements.forEach((element) => element.classList.remove('is-active', 'is-group-active', 'is-revealed'));
    return this.animateTo(this.idleView || this.defaultView);
  }

  animateTo(target, { duration = 460, updateIdle = false } = {}) {
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

  addProjectionObserver(callback) {
    if (typeof callback !== 'function') return () => {};
    this.projectionObservers.add(callback);
    callback();
    return () => this.projectionObservers.delete(callback);
  }

  projectionFrame() {
    const width = this.stage.clientWidth || 1;
    const height = this.stage.clientHeight || 1;
    if (this.projection === 'flat') {
      return computeFlatProjectionFrame({
        width,
        height,
        sourceAspect: this.sourceAspect,
        view: this.view,
        defaultFov: this.defaultView.fov,
      });
    }
    const forward = {
      x: -Math.sin(this.view.yaw) * Math.cos(this.view.pitch),
      y: Math.sin(this.view.pitch),
      z: -Math.cos(this.view.yaw) * Math.cos(this.view.pitch),
    };
    const right = { x: Math.cos(this.view.yaw), y: 0, z: -Math.sin(this.view.yaw) };
    return {
      width,
      height,
      aspect: width / height,
      forward,
      right,
      up: cross(right, forward),
      tanHalfFov: Math.tan(this.view.fov / 2),
    };
  }

  projectPoint(yaw, pitch, frame = this.projectionFrame()) {
    if (this.projection === 'flat') return projectFlatPoint(yaw, pitch, frame);
    const world = {
      x: -Math.sin(yaw) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * Math.cos(pitch),
    };
    const localX = dot(world, frame.right);
    const localY = dot(world, frame.up);
    const localZ = dot(world, frame.forward);
    const ndcX = localX / (Math.max(localZ, 0.001) * frame.tanHalfFov * frame.aspect);
    const ndcY = localY / (Math.max(localZ, 0.001) * frame.tanHalfFov);
    return {
      x: (ndcX * 0.5 + 0.5) * frame.width,
      y: (-ndcY * 0.5 + 0.5) * frame.height,
      ndcX,
      ndcY,
      localZ,
      depthScale: clamp(0.78 + localZ * 0.24, 0.82, 1.05),
      visible: localZ > 0.05 && Math.abs(ndcX) < 1.14 && Math.abs(ndcY) < 1.18,
    };
  }

  unprojectPoint(clientX, clientY) {
    const frame = this.projectionFrame();
    const rect = this.stage.getBoundingClientRect();
    if (this.projection === 'flat') {
      return unprojectFlatPoint(clientX - rect.left, clientY - rect.top, frame);
    }
    const ndcX = (((clientX - rect.left) / frame.width) - 0.5) * 2;
    const ndcY = -((((clientY - rect.top) / frame.height) - 0.5) * 2);
    const local = {
      x: ndcX * frame.tanHalfFov * frame.aspect,
      y: ndcY * frame.tanHalfFov,
      z: 1,
    };
    const world = {
      x: frame.right.x * local.x + frame.up.x * local.y + frame.forward.x * local.z,
      y: frame.right.y * local.x + frame.up.y * local.y + frame.forward.y * local.z,
      z: frame.right.z * local.x + frame.up.z * local.y + frame.forward.z * local.z,
    };
    const length = Math.hypot(world.x, world.y, world.z) || 1;
    world.x /= length;
    world.y /= length;
    world.z /= length;
    return {
      yaw: wrapAngle(Math.atan2(-world.x, -world.z)),
      pitch: Math.asin(clamp(world.y, -1, 1)),
    };
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
      gl.uniform1f(this.uniforms.projection, this.projection === 'flat' ? 1 : 0);
      if (this.projection === 'flat') {
        const frame = this.projectionFrame();
        gl.uniform2f(this.uniforms.flatCenter, frame.centerU, frame.centerV);
        gl.uniform2f(this.uniforms.flatSpan, frame.spanU, frame.spanV);
        gl.uniform4f(
          this.uniforms.flatRect,
          frame.contentX * dpr,
          (this.stage.clientHeight - frame.contentY - frame.contentHeight) * dpr,
          frame.contentWidth * dpr,
          frame.contentHeight * dpr,
        );
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    this.projectHotspots();
    if (this.animation) this.requestRender();
  }

  projectHotspots() {
    const frame = this.projectionFrame();

    for (const hotspot of this.hotspots) {
      const element = this.hotspotElements.get(hotspot.id);
      const point = this.projectPoint(hotspot.yaw, hotspot.pitch, frame);
      const visible = projectedHotspotFitsViewport(point, frame, hotspot);
      element.hidden = !visible;
      if (!visible) continue;
      element.style.left = `${point.x}px`;
      element.style.top = `${point.y}px`;
      element.style.setProperty('--depth-scale', point.depthScale.toFixed(3));
    }
    this.projectionObservers.forEach((callback) => callback());
  }
}
