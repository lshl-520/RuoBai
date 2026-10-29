import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CROP_MAX_ZOOM,
  CROP_MIN_ZOOM,
  PORTRAIT_ASPECT,
  cropOutputSize,
  resolveCropView,
  sourceRectFromView,
  zoomAroundCenter,
} from "../lib/portrait-crop.js";

/**
 * 上传立绘时的「选框」弹层（2026/10/14 用户拍板的第 2 步）。
 *
 * 需求：像微信设头像那样，自己拖、自己放大缩小，裁成统一的
 * 3:4 —— 横图、方图、细长竖图从此都一样，用户还有控制权。
 *
 * 只做显示与手势；几何计算全在 lib/portrait-crop.js（那份有单元测试）。
 * 确认时用离屏 canvas 把框内那一块画出来，输出 PNG（保留透明背景）。
 */

const DEFAULT_FRAME_WIDTH = 240;
const FALLBACK_FRAME = {
  w: DEFAULT_FRAME_WIDTH,
  h: Math.round(DEFAULT_FRAME_WIDTH / PORTRAIT_ASPECT),
};

export default function PortraitCropDialog({ src, onCancel, onConfirm, busy = false }) {
  const frameRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const imageRef = useRef(null);

  const [frame, setFrame] = useState(FALLBACK_FRAME);
  const [natural, setNatural] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  // 载入原图：拿真实像素尺寸，并用这个离屏元素做最后的裁图。
  useEffect(() => {
    setNatural(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError("");
    if (!src) return undefined;
    const image = new Image();
    imageRef.current = image;
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setNatural({ w: image.naturalWidth, h: image.naturalHeight });
      } else {
        setError("这张图读不出尺寸，换一张试试");
      }
    };
    image.onerror = () => setError("这张图打不开，换一张试试");
    image.src = src;
    return () => {
      image.onload = null;
      image.onerror = null;
      if (imageRef.current === image) imageRef.current = null;
    };
  }, [src]);

  // 取景框的实际像素尺寸（手机上比 240 窄），几何计算要用它。
  useEffect(() => {
    const measure = () => {
      const node = frameRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setFrame({ w: rect.width, h: rect.height });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Esc 关掉弹层。
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const view = useMemo(() => {
    if (!natural) return null;
    return resolveCropView({
      frameW: frame.w,
      frameH: frame.h,
      imageW: natural.w,
      imageH: natural.h,
      zoom,
      offsetX: offset.x,
      offsetY: offset.y,
    });
  }, [natural, frame, zoom, offset]);

  const applyView = (next) => {
    if (!next) return;
    setZoom(next.zoom);
    setOffset({ x: next.offsetX, y: next.offsetY });
  };

  const pinchDistance = () => {
    const points = Array.from(pointersRef.current.values());
    if (points.length < 2) return 0;
    const [a, b] = points;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (event) => {
    if (busy || working || !view) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size >= 2) {
      gestureRef.current = { kind: "pinch", distance: pinchDistance(), zoom: view.zoom };
    } else {
      gestureRef.current = {
        kind: "drag",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: view.offsetX,
        offsetY: view.offsetY,
      };
    }
  };

  const onPointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId) || !view) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (gesture.kind === "pinch") {
      const distance = pinchDistance();
      if (gesture.distance > 0 && distance > 0) {
        applyView(zoomAroundCenter(view, gesture.zoom * (distance / gesture.distance)));
      }
      return;
    }

    // 单指/鼠标拖动：跟手 1:1。
    if (gesture.pointerId !== event.pointerId) return;
    applyView(resolveCropView({
      frameW: frame.w,
      frameH: frame.h,
      imageW: natural.w,
      imageH: natural.h,
      zoom: view.zoom,
      offsetX: gesture.offsetX + (event.clientX - gesture.startX),
      offsetY: gesture.offsetY + (event.clientY - gesture.startY),
    }));
  };

  const endPointer = (event) => {
    pointersRef.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (pointersRef.current.size === 0) {
      gestureRef.current = null;
    } else if (pointersRef.current.size === 1 && view) {
      const [remaining] = Array.from(pointersRef.current.entries());
      gestureRef.current = {
        kind: "drag",
        pointerId: remaining[0],
        startX: remaining[1].x,
        startY: remaining[1].y,
        offsetX: view.offsetX,
        offsetY: view.offsetY,
      };
    }
  };

  const onWheel = (event) => {
    if (!view) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    applyView(zoomAroundCenter(view, view.zoom * factor));
  };

  const reset = () => {
    if (!natural) return;
    applyView(resolveCropView({
      frameW: frame.w,
      frameH: frame.h,
      imageW: natural.w,
      imageH: natural.h,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    }));
  };

  const confirm = async () => {
    const image = imageRef.current;
    if (!image || !natural || !view || busy || working) return;
    setWorking(true);
    setError("");
    try {
      const rect = sourceRectFromView(view);
      const out = cropOutputSize(rect.sw, rect.sh);
      const canvas = document.createElement("canvas");
      canvas.width = out.width;
      canvas.height = out.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("这台设备不支持裁剪，换用浏览器上传试试");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, out.width, out.height);
      ctx.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, out.width, out.height);
      const dataUrl = canvas.toDataURL("image/png");
      if (!dataUrl || !dataUrl.startsWith("data:image/png")) {
        throw new Error("裁剪结果生成失败，换一张图试试");
      }
      await onConfirm(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "裁剪失败，换一张图试试");
    } finally {
      setWorking(false);
    }
  };

  const zoomPercent = Math.round((view?.zoom ?? 1) * 100);
  const disabled = busy || working;

  return (
    <div
      className="sheet-mask portrait-crop-mask"
      onClick={(event) => {
        // 这个弹层是嵌在「编辑角色」弹层里的，点空白处别把下面那层也一起关掉。
        event.stopPropagation();
        if (!disabled) onCancel?.();
      }}
    >
      <div className="sheet portrait-crop-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">裁一下她的立绘</h2>
          <button className="icon-btn" onClick={onCancel} disabled={disabled} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <div className="sheet-body">
          <p className="pc-tip">
            拖动图片调整位置，双指（或用下面的滑杆）缩放。框是固定的 <b>3:4</b>，
            裁出来的和她自带的样子一致。原图不会丢，以后想换一段再裁一次就行。
          </p>

          <div className="pc-stage">
            <div
              className="pc-frame"
              ref={frameRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              onWheel={onWheel}
            >
              {natural && view ? (
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  style={{
                    width: view.displayW,
                    height: view.displayH,
                    left: view.offsetX,
                    top: view.offsetY,
                  }}
                />
              ) : (
                <div className="pc-loading">{src ? "正在读这张图…" : "没有可用的图片"}</div>
              )}
              <div className="pc-grid" aria-hidden="true" />
            </div>
            <div className="pc-preview-hint">框内就是她在聊天室里的样子</div>
          </div>

          <div className="pc-controls">
            <span className="pc-zoom-label">缩放</span>
            <input
              type="range"
              min={CROP_MIN_ZOOM * 100}
              max={CROP_MAX_ZOOM * 100}
              value={zoomPercent}
              disabled={!natural || disabled}
              onChange={(event) => {
                if (!view) return;
                applyView(zoomAroundCenter(view, Number(event.target.value) / 100));
              }}
            />
            <span className="pc-zoom-value">{zoomPercent}%</span>
          </div>

          <button type="button" className="pc-reset" onClick={reset} disabled={!natural || disabled}>复位</button>

          {error ? <div className="pc-error">{error}</div> : null}
        </div>

        <div className="sheet-foot">
          <button type="button" className="pill pill-ghost" onClick={onCancel} disabled={disabled}>取消</button>
          <button type="button" className="pill pill-primary grow" onClick={confirm} disabled={disabled || !natural}>
            {busy || working ? "处理中…" : "就用这张"}
          </button>
        </div>
      </div>
    </div>
  );
}