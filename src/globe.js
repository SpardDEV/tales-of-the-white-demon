import { TERRAIN_GLYPHS } from "./config.js";

const DEG2RAD = Math.PI / 180;

export class SphereGlobe {
  constructor(canvas, onSelectNode) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onSelectNode = onSelectNode;
    this.sphere = null;
    this.activeNodeId = null;
    this.selectedNodeId = null;

    this.rotLon = 0;
    this.rotLat = 15;
    this.zoom = 1.0;

    this.dragging = false;
    this.moved = false;
    this.lastX = 0;
    this.lastY = 0;
    this.pinchDist = null;
    this.projectedNodes = [];

    this._bindEvents();
  }

  setSphere(sphere, activeNodeId) {
    this.sphere = sphere;
    this.activeNodeId = activeNodeId;
    if (sphere && sphere.nodes?.length) {
      const current = sphere.nodes.find((n) => n.id === activeNodeId) || sphere.nodes[0];
      if (!this.selectedNodeId) this.selectedNodeId = current.id;
    }
    this.render();
  }

  centerOnActive() {
    if (!this.sphere?.nodes?.length) return;
    const node = this.sphere.nodes.find((n) => n.id === this.activeNodeId) || this.sphere.nodes[0];
    this.rotLon = -node.lon;
    this.rotLat = node.lat;
    this.zoom = 1.15;
    this.render();
  }

  zoomBy(factor) {
    this.zoom = Math.max(0.65, Math.min(3.5, this.zoom * factor));
    this.render();
  }

  _project(latDeg, lonDeg, cx, cy, radius) {
    const lat = latDeg * DEG2RAD;
    const lon = (lonDeg + this.rotLon) * DEG2RAD;
    const tilt = this.rotLat * DEG2RAD;

    const x0 = Math.cos(lat) * Math.sin(lon);
    const y0 = Math.sin(lat);
    const z0 = Math.cos(lat) * Math.cos(lon);

    // Rotação vertical (inclinação da esfera)
    const y1 = y0 * Math.cos(tilt) - z0 * Math.sin(tilt);
    const z1 = y0 * Math.sin(tilt) + z0 * Math.cos(tilt);

    return {
      x: cx + x0 * radius,
      y: cy - y1 * radius,
      z: z1,
      visible: z1 > -0.05
    };
  }

  render() {
    const canvas = this.canvas;
    const rect = canvas.parentElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const baseR = Math.min(rect.width, rect.height) * 0.37;
    const radius = baseR * this.zoom;

    // Halo externo da esfera
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.65, cx, cy, radius * 1.12);
    grad.addColorStop(0, "rgba(18, 42, 68, 0.32)");
    grad.addColorStop(0.85, "rgba(10, 24, 42, 0.72)");
    grad.addColorStop(1, "rgba(34, 211, 238, 0.0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.12, 0, Math.PI * 2);
    ctx.fill();

    // Contorno digital do globo
    ctx.strokeStyle = "rgba(103, 232, 249, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Linhas de grade (Fog of War digital)
    ctx.strokeStyle = "rgba(103, 232, 249, 0.12)";
    ctx.lineWidth = 1;
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      let started = false;
      for (let lon = -180; lon <= 180; lon += 6) {
        const pt = this._project(lat, lon, cx, cy, radius);
        if (pt.visible) {
          if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
          else ctx.lineTo(pt.x, pt.y);
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }
    for (let lon = -180; lon < 180; lon += 30) {
      ctx.beginPath();
      let started = false;
      for (let lat = -85; lat <= 85; lat += 5) {
        const pt = this._project(lat, lon, cx, cy, radius);
        if (pt.visible) {
          if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
          else ctx.lineTo(pt.x, pt.y);
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }

    if (!this.sphere) return;
    const nodes = (this.sphere.nodes || []).filter((n) => n.discovered !== false);

    // Conexões entre pontos descobertos
    ctx.strokeStyle = "rgba(167, 139, 250, 0.55)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    for (const node of nodes) {
      for (const targetId of node.connectedTo || []) {
        if (node.id >= targetId) continue;
        const target = nodes.find((n) => n.id === targetId);
        if (!target) continue;
        const steps = 16;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const lat = node.lat + (target.lat - node.lat) * t;
          const lon = node.lon + (target.lon - node.lon) * t;
          const pt = this._project(lat, lon, cx, cy, radius);
          if (pt.visible) {
            if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
            else ctx.lineTo(pt.x, pt.y);
          } else {
            started = false;
          }
        }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Nós e símbolos ASCII
    this.projectedNodes = [];
    for (const node of nodes) {
      const pt = this._project(node.lat, node.lon, cx, cy, radius);
      if (!pt.visible) continue;
      this.projectedNodes.push({ node, x: pt.x, y: pt.y });

      const isCurrent = node.id === this.activeNodeId;
      const isSelected = node.id === this.selectedNodeId;
      const glyph = node.asciiGlyph || TERRAIN_GLYPHS[node.terrain] || "◎";

      // Anel do local
      ctx.fillStyle = isCurrent ? "rgba(34, 211, 238, 0.25)" : "rgba(14, 22, 35, 0.85)";
      ctx.strokeStyle = isCurrent ? "#22d3ee" : isSelected ? "#fbbf24" : "#67e8f9";
      ctx.lineWidth = isCurrent || isSelected ? 2 : 1.2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isCurrent ? 14 : 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#e6f1ff";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph, pt.x, pt.y);

      if (this.zoom >= 0.9 || isCurrent || isSelected) {
        ctx.fillStyle = isCurrent ? "#67e8f9" : "#cbd5e1";
        ctx.font = "10px system-ui, sans-serif";
        ctx.fillText(node.name, pt.x, pt.y + 19);
      }
    }
  }

  _pickNode(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = null;
    let bestDist = 26;
    for (const item of this.projectedNodes) {
      const d = Math.hypot(item.x - x, item.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = item.node;
      }
    }
    if (best) {
      this.selectedNodeId = best.id;
      this.render();
      if (this.onSelectNode) this.onSelectNode(best);
    }
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.moved = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });

    window.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.moved = true;
      this.rotLon += dx * 0.45;
      this.rotLat = Math.max(-80, Math.min(80, this.rotLat + dy * 0.45));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.render();
    });

    window.addEventListener("pointerup", (e) => {
      if (this.dragging && !this.moved) {
        this._pickNode(e.clientX, e.clientY);
      }
      this.dragging = false;
    });

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.12 : 0.89);
    }, { passive: false });

    c.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (this.pinchDist) {
          this.zoomBy(d / this.pinchDist);
        }
        this.pinchDist = d;
      }
    }, { passive: true });

    c.addEventListener("touchend", () => {
      this.pinchDist = null;
    });

    window.addEventListener("resize", () => this.render());
  }
}
