import { ref, watch, onMounted, onBeforeUnmount } from "../../vendor/vue.esm-browser.js";
import { clamp01 } from "../../modules/utils.js";

const imageCache = new Map();
const MAX_IMAGE_CACHE = 120;

const touchCache = (url, entry) => {
  imageCache.delete(url);
  imageCache.set(url, entry);
  if (imageCache.size <= MAX_IMAGE_CACHE) return;
  const oldestKey = imageCache.keys().next().value;
  if (oldestKey) imageCache.delete(oldestKey);
};

const getImage = (url) => {
  if (!url) return Promise.reject(new Error("empty url"));
  const cached = imageCache.get(url);
  if (cached?.loaded && cached.img) {
    touchCache(url, cached);
    return Promise.resolve(cached.img);
  }
  if (cached?.promise) return cached.promise;
  const img = cached?.img || new Image();
  img.decoding = "async";
  const promise = new Promise((resolve, reject) => {
    img.onload = () => {
      touchCache(url, { img, loaded: true });
      resolve(img);
    };
    img.onerror = () => {
      touchCache(url, { img, loaded: false });
      reject(new Error("load failed"));
    };
  });
  touchCache(url, { img, loaded: false, promise });
  if (!img.src) img.src = url;
  return promise;
};

export default {
  name: "CropPreview",
  props: {
    imageUrl: { type: String, default: "" },
    bbox: { type: Array, required: true },
    label: { type: String, default: "" },
    lazyLevel: { type: String, default: "normal" }, // eager|near|normal|far
  },
  setup(props) {
    const canvasRef = ref(null);
    const rootRef = ref(null);
    const error = ref("");
    let observer = null;
    let hasDrawn = false;
    let needsDraw = false;
    let isVisible = false;
    let drawToken = 0;

    const draw = () => {
      const canvas = canvasRef.value;
      if (!canvas) return;
      const imgUrl = props.imageUrl || "";
      if (!imgUrl || !Array.isArray(props.bbox) || props.bbox.length !== 4) {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const [x0, y0, x1, y1] = props.bbox;
      const x0p = clamp01(Math.min(x0, x1));
      const y0p = clamp01(Math.min(y0, y1));
      const x1p = clamp01(Math.max(x0, x1));
      const y1p = clamp01(Math.max(y0, y1));
      const wN = Math.max(0.001, x1p - x0p);
      const hN = Math.max(0.001, y1p - y0p);

      const token = ++drawToken;
      getImage(imgUrl).then((img) => {
        if (token !== drawToken) return;
        const imgW = img.naturalWidth || 1;
        const imgH = img.naturalHeight || 1;
        const srcW = Math.max(1, Math.round(wN * imgW));
        const srcH = Math.max(1, Math.round(hN * imgH));

        const containerW = rootRef.value?.clientWidth || 0;
        const fallbackW = Math.min(640, srcW);
        const baseW = containerW || fallbackW;
        const targetW = Math.max(220, Math.min(srcW, baseW));
        const targetH = Math.max(1, Math.round((srcH / srcW) * targetW));
        const dpr = window.devicePixelRatio || 1;

        canvas.width = Math.round(targetW * dpr);
        canvas.height = Math.round(targetH * dpr);
        canvas.style.width = "100%";
        canvas.style.height = "auto";

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        const sx = Math.round(x0p * imgW);
        const sy = Math.round(y0p * imgH);
        ctx.clearRect(0, 0, targetW, targetH);
        ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, targetW, targetH);
        hasDrawn = true;
      }).catch(() => {
        if (token !== drawToken) return;
        error.value = `图片加载失败：${imgUrl}`;
      });
    };

    const drawIfVisible = () => {
      if (observer && !isVisible) {
        needsDraw = true;
        return;
      }
      draw();
    };

    onMounted(() => {
      const root = rootRef.value;
      const level = String(props.lazyLevel || "normal").toLowerCase();
      if (level === "eager") {
        draw();
        return;
      }
      if (root && "IntersectionObserver" in window) {
        const right = document.getElementById("right");
        const isScrollable = right && right.scrollHeight > right.clientHeight + 1;
        const scrollRoot = isScrollable ? right : null;
        const marginMap = {
          near: "600px 0px",
          normal: "300px 0px",
          far: "120px 0px",
        };
        const rootMargin = marginMap[level] || marginMap.normal;
        observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            isVisible = entry.isIntersecting;
            if (entry.isIntersecting) {
              if (needsDraw || !hasDrawn) {
                needsDraw = false;
                draw();
              }
              break;
            }
          }
        }, { root: scrollRoot, rootMargin });
        observer.observe(root);
      } else {
        draw();
      }
    });

    onBeforeUnmount(() => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    });

    watch(() => `${props.imageUrl || ""}|${Array.isArray(props.bbox) ? props.bbox.join(",") : ""}`, () => {
      error.value = "";
      hasDrawn = false;
      needsDraw = false;
      drawIfVisible();
    });

    return { canvasRef, rootRef, error };
  },
  template: `
    <div class="crop" ref="rootRef">
      <canvas ref="canvasRef"></canvas>
      <div v-if="label" class="label">{{ label }}</div>
      <div v-if="error" class="muted">{{ error }}</div>
    </div>
  `,
};
