const palettes = { plum: [0.48, 0.34, 0.85], lime: [0.55, 0.73, 0.28], peach: [0.95, 0.49, 0.35], sky: [0.3, 0.64, 0.86] };
const instances = new Map();
const VERTEX = `attribute vec3 position; attribute vec3 normal; uniform vec3 scale; uniform vec3 center; uniform float turn; uniform float aspect;
varying vec3 n; varying vec3 world;
void main(){mat3 r=mat3(cos(turn),0.,-sin(turn),0.,1.,0.,sin(turn),0.,cos(turn));vec3 p=r*(position*scale+center);
n=normalize(r*(normal/scale));world=p;gl_Position=vec4(p.x/(aspect*1.3),p.y/1.3,-p.z/5.,1.);}`;
const FRAGMENT = `precision mediump float; varying vec3 n; varying vec3 world; uniform vec3 color; uniform float alpha;
void main(){float diffuse=max(dot(normalize(n),normalize(vec3(-.6,1.,1.4))),0.);float shine=pow(max(dot(normalize(n),normalize(vec3(-.35,.8,1.5))),0.),28.)*.17;
gl_FragColor=vec4(color*(.58+.42*diffuse)+shine,alpha);}`;
function sphereMesh() {
  const vertices = [], normals = [], indices = []; const rows = 20, cols = 28;
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
    const theta = y * Math.PI / rows, phi = x * 2 * Math.PI / cols;
    const point = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)]; vertices.push(...point); normals.push(...point);
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const a = y * (cols + 1) + x, b = a + cols + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
  return { vertices, normals, indices };
}
const mesh = sphereMesh();
class Character {
  constructor(canvas) {
    this.canvas = canvas; this.kind = canvas.dataset.character; this.gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!this.gl) { canvas.hidden = true; const fallback = document.createElement('span'); fallback.className = 'character-fallback'; fallback.textContent = '◕‿◕'; canvas.after(fallback); return; }
    const gl = this.gl;
    const shader = (type, source) => { const item = gl.createShader(type); gl.shaderSource(item, source); gl.compileShader(item); if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error('Character shader failed'); return item; };
    const program = gl.createProgram(); gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT)); gl.linkProgram(program); gl.useProgram(program); this.program = program;
    for (const [name, values] of [['position', mesh.vertices], ['normal', mesh.normals]]) { const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW); const location = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0); }
    const indices = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);
    this.uniforms = Object.fromEntries(['scale', 'center', 'turn', 'aspect', 'color', 'alpha'].map(name => [name, gl.getUniformLocation(program, name)]));
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)'); this.visible = true;
    this.observer = new IntersectionObserver(entries => { this.visible = entries[0].isIntersecting; }); this.observer.observe(canvas);
    this.frame = requestAnimationFrame(t => this.render(t));
  }
  ball(center, scale, color, alpha = 1) {
    const gl = this.gl, u = this.uniforms; gl.uniform3fv(u.center, center); gl.uniform3fv(u.scale, scale); gl.uniform3fv(u.color, color); gl.uniform1f(u.alpha, alpha); gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
  }
  render(time) {
    if (!this.canvas.isConnected) { this.destroy(); return; }
    this.frame = requestAnimationFrame(t => this.render(t));
    if (!this.visible || document.hidden || time - (this.last || 0) < 40 || (this.reduced.matches && this.last)) return;
    this.last = time; const gl = this.gl, canvas = this.canvas, dpr = Math.min(devicePixelRatio, 2);
    const width = Math.round(canvas.clientWidth * dpr), height = Math.round(canvas.clientHeight * dpr);
    if (!width || !height) return;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.useProgram(this.program);
    const mood = canvas.dataset.mood || 'idle', bouncing = mood === 'happy' ? 0.1 : 0.025;
    const bob = this.reduced.matches ? 0 : Math.sin(time / (mood === 'happy' ? 120 : 520)) * bouncing;
    gl.uniform1f(this.uniforms.aspect, width / height); gl.uniform1f(this.uniforms.turn, this.reduced.matches ? -.15 : -.15 + Math.sin(time / 1400) * .13);
    const color = palettes[this.kind] || palettes.plum; const dark = color.map(x => x * .75); const white = [.99, .98, .94], black = [.12, .13, .18];
    this.ball([0, -.94, 0], [.7, .035, .35], [.25, .24, .3], .12);
    this.ball([-.3, -.78 + bob, .08], [.22, .15, .27], dark); this.ball([.3, -.78 + bob, .08], [.22, .15, .27], dark);
    this.ball([-.58, -.12 + bob, .03], [.15, .3, .16], color); this.ball([.58, -.12 + bob, .03], [.15, .3, .16], color);
    this.ball([0, -.06 + bob, 0], this.kind === 'lime' ? [.65, .57, .44] : [.55, .69, .43], color);
    const blink = !this.reduced.matches && time % 4200 < 140 ? .12 : 1;
    if (this.kind === 'sky') {
      this.ball([0, .22 + bob, .38], [.31, .32 * blink, .18], white); this.ball([.03, .21 + bob, .54], [.115, .15 * blink, .07], black);
      this.ball([0, .66 + bob, 0], [.47, .075, .38], [1, .73, .34]); this.ball([0, .77 + bob, 0], [.26, .16, .26], [1, .73, .34]);
    } else {
      const eyeY = this.kind === 'lime' ? .46 : .22;
      for (const x of [-.21, .21]) {
        if (this.kind === 'lime') this.ball([x * 1.5, eyeY + bob, .1], [.26, .29, .26], color);
        this.ball([x, eyeY + bob, .39], [.185, .21 * blink, .15], white); this.ball([x + .02, eyeY + bob, .52], [.078, .105 * blink, .057], black);
      }
      if (this.kind === 'plum') for (const x of [-.35, .35]) this.ball([x, .65 + bob, -.04], [.15, .27, .14], color);
      if (this.kind === 'peach') { this.ball([0, .68 + bob, 0], [.055, .25, .06], dark); this.ball([0, .93 + bob, 0], [.14, .12, .12], [1, .78, .37]); }
    }
    this.ball([0, -.18 + bob, .4], [.15, mood === 'surprise' ? .16 : .085, .055], black);
    this.ball([.035, -.195 + bob, .46], [.075, .036, .018], [.94, .47, .5]);
    if (this.kind === 'plum') this.ball([-.04, -.115 + bob, .46], [.045, .045, .025], white);
  }
  destroy() { cancelAnimationFrame(this.frame); this.observer?.disconnect(); this.gl?.getExtension('WEBGL_lose_context')?.loseContext(); instances.delete(this.canvas); }
}
export function mountCharacters() {
  for (const [canvas, instance] of instances) if (!canvas.isConnected) instance.destroy();
  document.querySelectorAll('canvas[data-character]').forEach(canvas => { if (!instances.has(canvas)) instances.set(canvas, new Character(canvas)); });
}
export function setCharacterMood(mood) { document.querySelectorAll('canvas[data-character]').forEach(canvas => { canvas.dataset.mood = mood; }); }
