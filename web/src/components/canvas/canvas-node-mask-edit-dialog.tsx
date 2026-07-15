import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Input, Modal, Segmented, Select, Slider } from "antd";
import { BoxSelect, Brush, Circle, Eraser, RotateCcw, Square, Trash2, WandSparkles, X } from "lucide-react";

import { readImageMeta } from "@/lib/image-utils";

export type CanvasImageMaskEditPayload = {
    prompt: string;
    maskDataUrl: string;
};

type ToolMode = "shape" | "brush";
type SelectionKind = "rect" | "circle";
type BrushShapeKind = "circle" | "square";
type BrushMode = "paint" | "erase";
type HandleKind = "nw" | "ne" | "sw" | "se";

type Point = { x: number; y: number };
type Selection = { id: string; kind: SelectionKind; x: number; y: number; width: number; height: number };
type Rect = { x: number; y: number; width: number; height: number };

type DragInfo =
    | { kind: "create" }
    | { kind: "move"; id: string; start: Point; origin: Point }
    | { kind: "resize"; id: string; handle: HandleKind; start: Point; origin: Selection };

const defaultBrushSize = 100;
const defaultBrushShape: BrushShapeKind = "circle";
const minSelectionSize = 6;
const maskFillColor = "rgba(37, 99, 235, .38)";
const maskBorderColor = "rgba(255, 255, 255, .72)";
const selectionFillColor = "rgba(37, 99, 235, .28)";
const selectionBorderColor = "rgba(96, 165, 250, .95)";
const selectionSelectedBorderColor = "rgba(255, 255, 255, .95)";

const handleKinds: HandleKind[] = ["nw", "ne", "sw", "se"];
const handlePositions: Record<HandleKind, { left: string; top: string; cursor: string }> = {
    nw: { left: "0%", top: "0%", cursor: "nwse-resize" },
    ne: { left: "100%", top: "0%", cursor: "nesw-resize" },
    sw: { left: "0%", top: "100%", cursor: "nesw-resize" },
    se: { left: "100%", top: "100%", cursor: "nwse-resize" },
};

let selectionIdSeed = 0;
function createSelectionId() {
    selectionIdSeed += 1;
    return `selection-${Date.now()}-${selectionIdSeed}`;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

export function CanvasNodeMaskEditDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (payload: CanvasImageMaskEditPayload) => void }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const brushMaskCanvasRef = useRef<HTMLCanvasElement>(null);
    const shapeMaskCanvasRef = useRef<HTMLCanvasElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const brushDrawingRef = useRef<{ active: boolean; last: Point | null }>({ active: false, last: null });
    const dragRef = useRef<DragInfo | null>(null);
    const createStartRef = useRef<Point | null>(null);
    const draftRectRef = useRef<Rect | null>(null);

    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [prompt, setPrompt] = useState("");
    const [error, setError] = useState("");

    const [toolMode, setToolMode] = useState<ToolMode>("shape");

    const [newShapeKind, setNewShapeKind] = useState<SelectionKind>("rect");
    const [shapes, setShapes] = useState<Selection[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draftRect, setDraftRect] = useState<Rect | null>(null);
    const [displayScale, setDisplayScale] = useState(1);

    const [brushShape, setBrushShape] = useState<BrushShapeKind>(defaultBrushShape);
    const [brushSize, setBrushSize] = useState(defaultBrushSize);
    const [brushMode, setBrushMode] = useState<BrushMode>("paint");
    const [brushPointer, setBrushPointer] = useState<{ left: number; top: number; scale: number } | null>(null);

    useEffect(() => {
        if (!open) return;
        setPrompt("");
        setError("");
        setToolMode("shape");
        setNewShapeKind("rect");
        setShapes([]);
        setSelectedId(null);
        draftRectRef.current = null;
        setDraftRect(null);
        setBrushShape(defaultBrushShape);
        setBrushSize(defaultBrushSize);
        setBrushMode("paint");
        setBrushPointer(null);
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        clearCanvas(brushMaskCanvasRef.current);
        clearCanvas(shapeMaskCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
    }, [image]);

    useEffect(() => {
        const canvas = shapeMaskCanvasRef.current;
        if (!canvas || !image) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#000";
        for (const shape of shapes) {
            if (shape.kind === "rect") {
                context.fillRect(shape.x, shape.y, shape.width, shape.height);
                continue;
            }
            context.beginPath();
            context.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, Math.max(0.01, shape.width / 2), Math.max(0.01, shape.height / 2), 0, 0, Math.PI * 2);
            context.fill();
        }
    }, [shapes, image]);

    useEffect(() => {
        if (!image || !containerRef.current) return;
        const element = containerRef.current;
        const update = () => {
            const rect = element.getBoundingClientRect();
            if (rect.width > 0) setDisplayScale(rect.width / image.width);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [image]);

    const getImagePoint = (clientX: number, clientY: number): Point => {
        const element = containerRef.current;
        if (!element || !image) return { x: 0, y: 0 };
        const rect = element.getBoundingClientRect();
        const scale = rect.width / image.width || 1;
        return {
            x: clamp((clientX - rect.left) / scale, 0, image.width),
            y: clamp((clientY - rect.top) / scale, 0, image.height),
        };
    };

    useEffect(() => {
        if (!open) return;
        const handleMove = (event: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag || !image) return;
            const point = getImagePoint(event.clientX, event.clientY);
            if (drag.kind === "create") {
                const start = createStartRef.current;
                if (!start) return;
                const nextRect = normalizeRect(start, point);
                draftRectRef.current = nextRect;
                setDraftRect(nextRect);
                return;
            }
            if (drag.kind === "move") {
                setShapes((prev) =>
                    prev.map((shape) => {
                        if (shape.id !== drag.id) return shape;
                        const nextX = clamp(drag.origin.x + (point.x - drag.start.x), 0, Math.max(0, image.width - shape.width));
                        const nextY = clamp(drag.origin.y + (point.y - drag.start.y), 0, Math.max(0, image.height - shape.height));
                        return { ...shape, x: nextX, y: nextY };
                    }),
                );
                return;
            }
            if (drag.kind === "resize") {
                setShapes((prev) => prev.map((shape) => (shape.id === drag.id ? resizeSelection(drag.origin, drag.handle, point, image) : shape)));
            }
        };
        const handleUp = () => {
            const drag = dragRef.current;
            if (drag?.kind === "create") {
                const rect = draftRectRef.current;
                if (rect && rect.width >= minSelectionSize && rect.height >= minSelectionSize) {
                    const id = createSelectionId();
                    setShapes((prev) => [...prev, { id, kind: newShapeKind, x: rect.x, y: rect.y, width: rect.width, height: rect.height }]);
                    setSelectedId(id);
                }
                draftRectRef.current = null;
                setDraftRect(null);
            }
            dragRef.current = null;
            createStartRef.current = null;
        };
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp);
        window.addEventListener("pointercancel", handleUp);
        return () => {
            window.removeEventListener("pointermove", handleMove);
            window.removeEventListener("pointerup", handleUp);
            window.removeEventListener("pointercancel", handleUp);
        };
    }, [open, image, newShapeKind]);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!selectedId || toolMode !== "shape") return;
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
            if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                deleteShape(selectedId);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open, selectedId, toolMode]);

    const deleteShape = (id: string) => {
        setShapes((prev) => prev.filter((shape) => shape.id !== id));
        setSelectedId((current) => (current === id ? null : current));
    };

    const handleLayerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!image) return;
        event.preventDefault();
        const point = getImagePoint(event.clientX, event.clientY);
        createStartRef.current = point;
        dragRef.current = { kind: "create" };
        setSelectedId(null);
        draftRectRef.current = { x: point.x, y: point.y, width: 0, height: 0 };
        setDraftRect(draftRectRef.current);
    };

    const handleShapePointerDown = (event: ReactPointerEvent<HTMLDivElement>, shape: Selection) => {
        event.preventDefault();
        event.stopPropagation();
        const point = getImagePoint(event.clientX, event.clientY);
        dragRef.current = { kind: "move", id: shape.id, start: point, origin: { x: shape.x, y: shape.y } };
        setSelectedId(shape.id);
    };

    const handleHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>, shape: Selection, handle: HandleKind) => {
        event.preventDefault();
        event.stopPropagation();
        const point = getImagePoint(event.clientX, event.clientY);
        dragRef.current = { kind: "resize", id: shape.id, handle, start: point, origin: { ...shape } };
        setSelectedId(shape.id);
    };

    const drawBrush = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
        const canvas = brushMaskCanvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.lineWidth = brushSize;
        context.globalCompositeOperation = brushMode === "paint" ? "source-over" : "destination-out";
        context.strokeStyle = "#000";
        context.fillStyle = "#000";
        if (!brushDrawingRef.current.last) {
            drawMaskStroke(context, point, point, brushSize, brushShape);
        } else {
            drawMaskStroke(context, brushDrawingRef.current.last, point, brushSize, brushShape);
        }
        renderMaskPreview(canvas, previewCanvasRef.current);
        brushDrawingRef.current.last = point;
        if (brushMode === "paint") setError("");
    };

    const startBrush = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateBrushPointer(event);
        brushDrawingRef.current = { active: true, last: null };
        if (brushMaskCanvasRef.current) renderMaskPreview(brushMaskCanvasRef.current, previewCanvasRef.current);
        drawBrush(event);
    };

    const updateBrushPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = event.currentTarget;
        const rect = canvas.getBoundingClientRect();
        setBrushPointer({
            left: event.clientX - rect.left,
            top: event.clientY - rect.top,
            scale: rect.width / Math.max(1, canvas.width),
        });
    };

    const moveBrush = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        updateBrushPointer(event);
        if (!brushDrawingRef.current.active) return;
        event.preventDefault();
        drawBrush(event);
    };

    const stopBrush = () => {
        brushDrawingRef.current = { active: false, last: null };
        const canvas = brushMaskCanvasRef.current;
        if (canvas) renderMaskPreview(canvas, previewCanvasRef.current, canvasHasPaint(canvas));
    };

    const resetMask = () => {
        clearCanvas(brushMaskCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
        setShapes([]);
        setSelectedId(null);
        draftRectRef.current = null;
        setDraftRect(null);
        setError("");
    };

    const submit = () => {
        const nextPrompt = prompt.trim();
        if (!nextPrompt) return setError("请输入修改要求");
        const brushCanvas = brushMaskCanvasRef.current;
        const shapeCanvas = shapeMaskCanvasRef.current;
        if (!brushCanvas || !shapeCanvas || !image) return;
        const hasBrush = canvasHasPaint(brushCanvas);
        if (!hasBrush && shapes.length === 0) return setError("请先框选或涂抹局部区域");
        const merged = mergeSelectionCanvases(brushCanvas, shapeCanvas, image.width, image.height);
        onConfirm({ prompt: nextPrompt, maskDataUrl: buildEditMask(merged) });
    };

    const selectedShape = useMemo(() => shapes.find((shape) => shape.id === selectedId) ?? null, [shapes, selectedId]);

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={980} centered destroyOnHidden>
            <div className="grid gap-5 lg:grid-cols-[minmax(360px,1fr)_320px]">
                <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-black/10 bg-transparent p-0 dark:border-white/10">
                    <div ref={containerRef} className="relative inline-block max-w-full overflow-hidden rounded-lg bg-transparent select-none">
                        <img src={dataUrl} alt="" className="block max-h-[68vh] max-w-full bg-transparent" draggable={false} />
                        {image ? (
                            <>
                                <canvas ref={brushMaskCanvasRef} width={image.width} height={image.height} className="hidden" />
                                <canvas ref={shapeMaskCanvasRef} width={image.width} height={image.height} className="hidden" />
                                <canvas ref={previewCanvasRef} width={image.width} height={image.height} className="pointer-events-none absolute inset-0 h-full w-full" />

                                {toolMode === "brush" ? (
                                    <>
                                        <canvas
                                            width={image.width}
                                            height={image.height}
                                            className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                                            onPointerDown={startBrush}
                                            onPointerMove={moveBrush}
                                            onPointerEnter={updateBrushPointer}
                                            onPointerLeave={() => setBrushPointer(null)}
                                            onPointerUp={stopBrush}
                                            onPointerCancel={stopBrush}
                                        />
                                        {brushPointer ? (
                                            <div
                                                className="pointer-events-none absolute z-10"
                                                style={{
                                                    left: brushPointer.left,
                                                    top: brushPointer.top,
                                                    width: Math.max(4, brushSize * brushPointer.scale),
                                                    height: Math.max(4, brushSize * brushPointer.scale),
                                                    transform: "translate(-50%, -50%)",
                                                    border: "1.5px solid rgba(255, 255, 255, .92)",
                                                    boxShadow: "0 0 0 1px rgba(0, 0, 0, .38)",
                                                    borderRadius: brushShape === "circle" ? "9999px" : "3px",
                                                }}
                                            />
                                        ) : null}
                                    </>
                                ) : (
                                    <div className="absolute inset-0 touch-none" style={{ cursor: "crosshair" }} onPointerDown={handleLayerPointerDown}>
                                        {draftRect ? <SelectionOverlay shape={{ id: "__draft__", kind: newShapeKind, ...draftRect }} scale={displayScale} selected={false} preview /> : null}
                                        {shapes.map((shape) => (
                                            <SelectionOverlay
                                                key={shape.id}
                                                shape={shape}
                                                scale={displayScale}
                                                selected={shape.id === selectedId}
                                                onPointerDownBody={(event) => handleShapePointerDown(event, shape)}
                                                onPointerDownHandle={(event, handle) => handleHandlePointerDown(event, shape, handle)}
                                                onDelete={() => deleteShape(shape.id)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : null}
                    </div>
                </div>

                <div className="flex min-h-[360px] flex-col gap-5">
                    <div>
                        <h2 className="text-xl font-semibold">局部遮罩编辑</h2>
                        <div className="mt-2 text-sm opacity-60">{image ? `${image.width} x ${image.height}px` : "读取中"}</div>
                    </div>

                    <Segmented
                        block
                        value={toolMode}
                        onChange={(value) => setToolMode(value as ToolMode)}
                        options={[
                            {
                                value: "shape",
                                label: (
                                    <span className="flex items-center justify-center gap-1.5 py-0.5">
                                        <BoxSelect className="size-4" />
                                        框选
                                    </span>
                                ),
                            },
                            {
                                value: "brush",
                                label: (
                                    <span className="flex items-center justify-center gap-1.5 py-0.5">
                                        <Brush className="size-4" />
                                        笔刷
                                    </span>
                                ),
                            },
                        ]}
                    />

                    {toolMode === "shape" ? (
                        <>
                            <div className="space-y-2">
                                <div className="text-sm font-medium opacity-75">新建选区形状</div>
                                <Select
                                    value={newShapeKind}
                                    onChange={setNewShapeKind}
                                    className="w-full"
                                    options={[
                                        {
                                            value: "rect",
                                            label: (
                                                <span className="flex items-center gap-2">
                                                    <Square className="size-4" />
                                                    矩形
                                                </span>
                                            ),
                                        },
                                        {
                                            value: "circle",
                                            label: (
                                                <span className="flex items-center gap-2">
                                                    <Circle className="size-4" />
                                                    圆形
                                                </span>
                                            ),
                                        },
                                    ]}
                                />
                            </div>

                            <div className="rounded-lg border border-black/10 bg-black/[.03] p-3 text-xs leading-relaxed opacity-70 dark:border-white/10 dark:bg-white/[.04]">
                                在左侧图片上拖拽绘制选区；点击选区可拖动位置，拖拽四角可调整大小；可添加多个选区，选中后按 Delete 或点击右上角叉号删除。
                            </div>

                            {shapes.length > 0 ? (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="opacity-70">已添加 {shapes.length} 个选区</span>
                                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedShape} onClick={() => selectedId && deleteShape(selectedId)}>
                                        删除选中
                                    </Button>
                                </div>
                            ) : null}
                        </>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-2">
                                <Button type={brushMode === "paint" ? "primary" : "default"} icon={<Brush className="size-4" />} onClick={() => setBrushMode("paint")}>
                                    画笔
                                </Button>
                                <Button type={brushMode === "erase" ? "primary" : "default"} icon={<Eraser className="size-4" />} onClick={() => setBrushMode("erase")}>
                                    擦除
                                </Button>
                            </div>

                            <div className="space-y-2">
                                <div className="text-sm font-medium opacity-75">笔刷形状</div>
                                <Select
                                    value={brushShape}
                                    onChange={setBrushShape}
                                    className="w-full"
                                    options={[
                                        {
                                            value: "circle",
                                            label: (
                                                <span className="flex items-center gap-2">
                                                    <Circle className="size-4" />
                                                    圆形
                                                </span>
                                            ),
                                        },
                                        {
                                            value: "square",
                                            label: (
                                                <span className="flex items-center gap-2">
                                                    <Square className="size-4" />
                                                    方形
                                                </span>
                                            ),
                                        },
                                    ]}
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium opacity-75">{brushShape === "square" ? "笔刷边长" : "笔刷大小"}</span>
                                    <span className="font-semibold">{brushSize}px</span>
                                </div>
                                <Slider min={8} max={240} step={2} value={brushSize} onChange={setBrushSize} />
                            </div>
                        </>
                    )}

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">修改要求</div>
                        <Input.TextArea
                            rows={6}
                            value={prompt}
                            status={error && !prompt.trim() ? "error" : undefined}
                            placeholder="例如：把选中区域改成金属材质，保持原图光影"
                            onChange={(event) => {
                                setPrompt(event.target.value);
                                setError("");
                            }}
                        />
                        {error ? <div className="text-xs font-medium text-[#ef4444]">{error}</div> : null}
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-2">
                        <Button icon={<RotateCcw className="size-4" />} onClick={resetMask}>
                            重置
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button icon={<X className="size-4" />} onClick={onClose}>
                                取消
                            </Button>
                            <Button type="primary" icon={<WandSparkles className="size-4" />} onClick={submit}>
                                AI 修改
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function SelectionOverlay({
    shape,
    scale,
    selected,
    preview,
    onPointerDownBody,
    onPointerDownHandle,
    onDelete,
}: {
    shape: Selection;
    scale: number;
    selected: boolean;
    preview?: boolean;
    onPointerDownBody?: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerDownHandle?: (event: ReactPointerEvent<HTMLDivElement>, handle: HandleKind) => void;
    onDelete?: () => void;
}) {
    const style: CSSProperties = {
        left: shape.x * scale,
        top: shape.y * scale,
        width: Math.max(1, shape.width * scale),
        height: Math.max(1, shape.height * scale),
        borderRadius: shape.kind === "circle" ? "9999px" : 6,
        background: selectionFillColor,
        border: `2px ${preview ? "dashed" : "solid"} ${selected ? selectionSelectedBorderColor : selectionBorderColor}`,
        boxShadow: selected ? "0 0 0 1px rgba(0, 0, 0, .35)" : "none",
        cursor: preview ? "crosshair" : "move",
        touchAction: "none",
    };

    return (
        <div className="absolute" style={style} onPointerDown={preview ? undefined : onPointerDownBody}>
            {selected && !preview
                ? handleKinds.map((handle) => (
                      <div
                          key={handle}
                          className="absolute z-10 size-3 rounded-full border-2 border-[#2563eb] bg-white"
                          style={{
                              left: handlePositions[handle].left,
                              top: handlePositions[handle].top,
                              transform: "translate(-50%, -50%)",
                              cursor: handlePositions[handle].cursor,
                              touchAction: "none",
                          }}
                          onPointerDown={(event) => onPointerDownHandle?.(event, handle)}
                      />
                  ))
                : null}
            {selected && !preview ? (
                <button
                    type="button"
                    className="absolute z-10 flex size-5 items-center justify-center rounded-full border border-white/70 bg-[#ef4444] text-white shadow"
                    style={{ right: -8, top: -8, touchAction: "none" }}
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onDelete?.();
                    }}
                >
                    <X className="size-3" />
                </button>
            ) : null}
        </div>
    );
}

function normalizeRect(start: Point, current: Point): Rect {
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);
    return { x, y, width, height };
}

function resizeSelection(origin: Selection, handle: HandleKind, point: Point, image: { width: number; height: number }): Selection {
    let left = origin.x;
    let top = origin.y;
    let right = origin.x + origin.width;
    let bottom = origin.y + origin.height;
    const px = clamp(point.x, 0, image.width);
    const py = clamp(point.y, 0, image.height);
    if (handle.includes("w")) left = Math.min(px, right - minSelectionSize);
    if (handle.includes("e")) right = Math.max(px, left + minSelectionSize);
    if (handle.includes("n")) top = Math.min(py, bottom - minSelectionSize);
    if (handle.includes("s")) bottom = Math.max(py, top + minSelectionSize);
    left = clamp(left, 0, image.width);
    right = clamp(right, 0, image.width);
    top = clamp(top, 0, image.height);
    bottom = clamp(bottom, 0, image.height);
    return { ...origin, x: left, y: top, width: Math.max(minSelectionSize, right - left), height: Math.max(minSelectionSize, bottom - top) };
}

function mergeSelectionCanvases(a: HTMLCanvasElement, b: HTMLCanvasElement, width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return a;
    context.drawImage(a, 0, 0);
    context.drawImage(b, 0, 0);
    return canvas;
}

function readCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
        y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawMaskStroke(context: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, size: number, shape: BrushShapeKind) {
    if (shape === "square") {
        stampSquares(context, from, to, size);
        return;
    }
    if (from.x === to.x && from.y === to.y) {
        context.beginPath();
        context.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
        context.fill();
        return;
    }
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
}

function stampSquares(context: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, size: number) {
    const half = size / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const stepCount = Math.max(1, Math.ceil(distance / Math.max(1, size / 4)));
    for (let index = 0; index <= stepCount; index += 1) {
        const t = index / stepCount;
        const x = from.x + dx * t;
        const y = from.y + dy * t;
        context.fillRect(x - half, y - half, size, size);
    }
}

function canvasHasPaint(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) return false;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 0) return true;
    }
    return false;
}

function renderMaskPreview(maskCanvas: HTMLCanvasElement, previewCanvas: HTMLCanvasElement | null, withBorder = false) {
    const context = previewCanvas?.getContext("2d");
    if (!previewCanvas || !context) return;
    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.fillStyle = maskFillColor;
    context.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(maskCanvas, 0, 0);
    context.globalCompositeOperation = "source-over";
    if (withBorder) drawDashedMaskBorder(context, maskCanvas);
}

function drawDashedMaskBorder(context: CanvasRenderingContext2D, maskCanvas: HTMLCanvasElement) {
    const maskContext = maskCanvas.getContext("2d");
    if (!maskContext) return;
    const { width, height } = maskCanvas;
    const data = maskContext.getImageData(0, 0, width, height).data;
    const step = Math.max(1, Math.round(Math.max(width, height) / 1200));
    const dash = step * 8;
    const gap = step * 5;
    const period = dash + gap;

    context.save();
    context.fillStyle = maskBorderColor;
    context.shadowColor = "rgba(0, 0, 0, .24)";
    context.shadowBlur = step * 1.5;
    for (let y = step; y < height - step; y += step) {
        for (let x = step; x < width - step; x += step) {
            const offset = (y * width + x) * 4 + 3;
            if (data[offset] === 0 || !isMaskEdge(data, width, x, y, step)) continue;
            if ((x + y) % period > dash) continue;
            context.fillRect(x - step / 2, y - step / 2, Math.max(1.5, step), Math.max(1.5, step));
        }
    }
    context.restore();
}

function isMaskEdge(data: Uint8ClampedArray, width: number, x: number, y: number, step: number) {
    return data[((y - step) * width + x) * 4 + 3] === 0 || data[((y + step) * width + x) * 4 + 3] === 0 || data[(y * width + x - step) * 4 + 3] === 0 || data[(y * width + x + step) * 4 + 3] === 0;
}

function buildEditMask(selectionCanvas: HTMLCanvasElement) {
    const canvas = document.createElement("canvas");
    canvas.width = selectionCanvas.width;
    canvas.height = selectionCanvas.height;
    const context = canvas.getContext("2d");
    if (!context) return selectionCanvas.toDataURL("image/png");
    const selectionContext = selectionCanvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!selectionContext) return canvas.toDataURL("image/png");
    const selection = selectionContext.getImageData(0, 0, canvas.width, canvas.height);
    const mask = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 3; index < mask.data.length; index += 4) {
        if (selection.data[index] > 0) mask.data[index] = 0;
    }
    context.putImageData(mask, 0, 0);
    return canvas.toDataURL("image/png");
}
