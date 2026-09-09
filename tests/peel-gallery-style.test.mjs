import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('任务模块独立加载，入口与内部模块分别使用对应缓存版本', () => {
  const html = read('index.html'), app = read('app.js'), ui = read('desire-mission-ui.js');
  const version = html.match(/desire-mission\.css\?v=([^"']+)/)?.[1];
  assert.ok(version);
  assert.match(html, /app\.js\?v=20260909-branch-integration-1/);
  assert.ok(app.includes(`desire-mission-ui.js?v=${version}`));
  assert.ok(ui.includes(`desire-mission-scene.js?v=${version}`));
  assert.ok(ui.includes(`desire-mission.js?v=${version}`));
});

test('原生任务仅依赖已有本地 Three.js 和项目资源，保留旧版本回退代码', () => {
  const scene = read('desire-mission-scene.js');
  assert.match(scene, /assets\/vendor\/three\/three\.module\.min\.js/);
  assert.doesNotMatch(scene, /https?:\/\/|\.glb|\.gltf/);
  assert.match(read('desire-observatory.js'), /createDesireObservatoryController/);
});

test('任务不访问业务存储和在线接口，保存只通过明确的提交事件', () => {
  const ui = read('desire-mission-ui.js');
  assert.doesNotMatch(ui, /localStorage|sessionStorage|XMLHttpRequest|fetch\(/);
  assert.match(ui, /listen\(root, 'submit', save\)/);
  assert.match(ui, /确认保存冷静单/);
  const gesture = ui.slice(ui.indexOf('function applyGestureFrame'), ui.indexOf('function pause('));
  assert.doesNotMatch(gesture, /mission-save|onIntent/);
  assert.match(gesture, /\['review', 'done'\]\.includes\(state.phase\)/);
});
