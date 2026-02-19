import { clamp01 } from "../../modules/utils.js";

export default {
  name: "CropCanvas",
  props: {
    imageUrl: { type: String, required: true },
    bbox: { type: Array, required: true },
    label: { type: String, default: "" },
    minWidth: { type: Number, default: 280 },
    maxWidth: { type: Number, default: 900 },
  },
  template: `
    <div class="crop">
      <canvas ref="canvas" style="width:100%; height:auto; display:block"></canvas>
      <span v-if="label" class="label">{{ label }}</span>
    </div>
  `,
  mounted() {
    this.draw();
  },
  watch: {
    imageUrl() { this.draw(); },
    bbox: { handler() { this.draw(); }, deep: true },
  },
  methods: {
    draw() {
      const canvas = this.$refs.canvas;
      if (!canvas || !this.imageUrl || !Array.isArray(this.bbox) || this.bbox.length !== 4) return;

      const [x0, y0, x1, y1] = this.bbox;
      const x0p = clamp01(Math.min(x0, x1));
      const y0p = clamp01(Math.min(y0, y1));
      const x1p = clamp01(Math.max(x0, x1));
      const y1p = clamp01(Math.max(y0, y1));
      const wN = Math.max(0.001, x1p - x0p);
      const hN = Math.max(0.001, y1p - y0p);

      const img = new Image();
      img.onload = () => {
        const imgW = img.naturalWidth || 1;
        const imgH = img.naturalHeight || 1;
        const srcW = Math.max(1, Math.round(wN * imgW));
        const srcH = Math.max(1, Math.round(hN * imgH));

        const targetW = Math.max(this.minWidth, Math.min(this.maxWidth, srcW));
        const targetH = Math.max(1, Math.round((srcH / srcW) * targetW));

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(targetW * dpr);
        canvas.height = Math.round(targetH * dpr);
        canvas.style.width = "100%";
        canvas.style.height = "auto";

        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        const sx = Math.round(x0p * imgW);
        const sy = Math.round(y0p * imgH);
        ctx.clearRect(0, 0, targetW, targetH);
        ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, targetW, targetH);
      };
      img.onerror = () => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = 400;
        canvas.height = 60;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#6b7280";
        ctx.font = "12px sans-serif";
        ctx.fillText("图片加载失败", 8, 20);
      };
      img.src = this.imageUrl;
    },
  },
};
