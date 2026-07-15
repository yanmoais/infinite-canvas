import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Wand2 } from "lucide-react";
import { Button, Switch } from "antd";

import { compatibleLoras, comfyPresetKey, fetchComfyPresets, recommendedLoraProfiles, recommendedLoras, type ComfyPresets } from "@/services/api/comfy";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeMetadata } from "@/types/canvas";

export type CanvasComfySettings = Pick<CanvasNodeMetadata, "comfyReferenceMode" | "comfyLoras" | "comfyFaceDetailer" | "comfyDenoise">;

type CanvasComfySettingsPopoverProps = {
    config: AiConfig;
    model: string;
    settings: CanvasComfySettings;
    onSettingsChange: (patch: CanvasComfySettings) => void;
    buttonClassName?: string;
};

export function CanvasComfySettingsPopover({ config, model, settings, onSettingsChange, buttonClassName }: CanvasComfySettingsPopoverProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const [presets, setPresets] = useState<ComfyPresets | null>(null);
    const [loadError, setLoadError] = useState("");
    const presetKey = comfyPresetKey(model);
    const referenceMode = settings.comfyReferenceMode || "none";
    const loras = settings.comfyLoras || [];
    const faceDetailerEnabled = settings.comfyFaceDetailer !== false;
    const summary = useMemo(() => {
        const modeLabel = presets?.referenceModes.find((item) => item.key === referenceMode)?.label || (referenceMode === "none" ? "无参考" : referenceMode);
        const parts = [modeLabel];
        if (Array.isArray(settings.comfyLoras)) parts.push(loras.length ? `LoRA×${loras.length}` : "LoRA裸跑");
        if (faceDetailerEnabled) parts.push(settings.comfyFaceDetailer === undefined ? "面部精修(默认)" : "面部精修");
        return parts.join(" · ");
    }, [faceDetailerEnabled, presets, referenceMode, loras.length, settings.comfyFaceDetailer, settings.comfyLoras]);

    useEffect(() => {
        if (!open) return;
        setLoadError("");
        fetchComfyPresets(config, model)
            .then(setPresets)
            .catch((error) => setLoadError(error instanceof Error ? error.message : "读取本地工作流配置失败"));
    }, [config, model, open]);

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [open]);

    const availableLoras = presets ? compatibleLoras(presets, presetKey) : [];
    const presetRecommendedLoras = presets ? recommendedLoras(presets, presetKey) : undefined;
    const recommendedSet = new Set(presetRecommendedLoras || []);
    const presetProfiles = presets ? recommendedLoraProfiles(presets, presetKey) : [];
    const toggleLora = (key: string) => {
        const next = loras.includes(key) ? loras.filter((item) => item !== key) : [...loras, key];
        onSettingsChange({ comfyLoras: next });
    };
    const applyLoras = (keys: string[]) => {
        const compatible = new Set(availableLoras.map((lora) => lora.key));
        onSettingsChange({ comfyLoras: keys.filter((key) => compatible.has(key)) });
    };

    const panel =
        open && buttonRect
            ? createPortal(
                  <div
                      ref={panelRef}
                      data-canvas-no-zoom
                      className="thin-scrollbar fixed z-[1200] max-h-[70vh] w-[360px] space-y-4 overflow-y-auto rounded-2xl border p-4 shadow-2xl"
                      style={{
                          background: theme.toolbar.panel,
                          borderColor: theme.toolbar.border,
                          color: theme.node.text,
                          left: Math.max(8, Math.min(buttonRect.left, window.innerWidth - 376)),
                          top: Math.max(8, buttonRect.top - 12 - Math.min(window.innerHeight * 0.7, 560)),
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                      onWheel={(event) => event.stopPropagation()}
                  >
                      <div className="text-sm font-semibold">本地工作流设置</div>
                      {loadError ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">{loadError}</div> : null}
                      {!presets && !loadError ? (
                          <div className="flex items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                              <Loader2 className="size-3.5 animate-spin" /> 正在读取本地工作流配置…
                          </div>
                      ) : null}
                      {presets ? (
                          <>
                              <div className="space-y-2">
                                  <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                      参考模式（需要连接参考图节点）
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                      {presets.referenceModes.map((mode) => (
                                          <button
                                              key={mode.key}
                                              type="button"
                                              className="cursor-pointer rounded-xl border px-2.5 py-2 text-left transition hover:opacity-80"
                                              style={{ borderColor: referenceMode === mode.key ? theme.node.text : theme.node.stroke, color: theme.node.text, background: "transparent" }}
                                              onClick={() => onSettingsChange({ comfyReferenceMode: mode.key })}
                                          >
                                              <div className="text-xs font-medium">{mode.label}</div>
                                              {mode.description ? (
                                                  <div className="mt-0.5 line-clamp-2 text-[10px] leading-3.5" style={{ color: theme.node.muted }}>
                                                      {mode.description}
                                                  </div>
                                              ) : null}
                                          </button>
                                      ))}
                                  </div>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                  <div>
                                      <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                          面部精修（生成后自动修脸）
                                      </div>
                                      {settings.comfyFaceDetailer === undefined ? (
                                          <div className="mt-0.5 text-[10px]" style={{ color: theme.node.muted }}>
                                              未显式设置，当前按网关默认开启
                                          </div>
                                      ) : null}
                                  </div>
                                  <Switch size="small" checked={faceDetailerEnabled} onChange={(checked) => onSettingsChange({ comfyFaceDetailer: checked })} />
                              </div>
                              <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                      <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                          重绘强度 denoise（img2img/蒙版用）
                                      </div>
                                      <span className="text-xs">{settings.comfyDenoise === false || settings.comfyDenoise === null ? "关闭" : (settings.comfyDenoise ?? "默认")}</span>
                                  </div>
                                  <input
                                      type="range"
                                      min={0.1}
                                      max={1}
                                      step={0.05}
                                      value={typeof settings.comfyDenoise === "number" ? settings.comfyDenoise : 0.75}
                                      className="w-full cursor-pointer"
                                      onChange={(event) => onSettingsChange({ comfyDenoise: Number(event.target.value) })}
                                  />
                                  {settings.comfyDenoise !== undefined ? (
                                      <button type="button" className="cursor-pointer text-[11px] underline" style={{ color: theme.node.muted }} onClick={() => onSettingsChange({ comfyDenoise: undefined })}>
                                          恢复默认
                                      </button>
                                  ) : null}
                              </div>
                               <div className="space-y-2">
                                   <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                       LoRA（当前模型兼容 {availableLoras.length} 个{loras.length ? `，已选 ${loras.length}` : Array.isArray(settings.comfyLoras) ? "，已明确裸跑" : ""}）
                                   </div>
                                   {presetRecommendedLoras !== undefined ? (
                                       <div className="flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: theme.node.muted }}>
                                           <span>推荐：{presetRecommendedLoras.length ? `${presetRecommendedLoras.length} 个` : "裸跑"}</span>
                                           <button type="button" className="cursor-pointer rounded-lg border px-2 py-1" style={{ borderColor: theme.node.stroke, color: theme.node.text }} onClick={() => applyLoras(presetRecommendedLoras)}>
                                               应用推荐
                                           </button>
                                           <button type="button" className="cursor-pointer rounded-lg border px-2 py-1" style={{ borderColor: theme.node.stroke, color: theme.node.text }} onClick={() => onSettingsChange({ comfyLoras: [] })}>
                                               裸跑
                                           </button>
                                       </div>
                                   ) : null}
                                   {presetProfiles.length ? (
                                       <div className="space-y-1">
                                           {presetProfiles.map((profile) => (
                                               <button
                                                   key={profile.key}
                                                   type="button"
                                                   className="w-full cursor-pointer rounded-lg border px-2.5 py-1.5 text-left transition hover:opacity-80"
                                                   style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.text }}
                                                   onClick={() => applyLoras(profile.loras)}
                                               >
                                                   <span className="block truncate text-[11px] font-medium">配方：{profile.label}</span>
                                                   {profile.notes ? (
                                                       <span className="block truncate text-[10px]" style={{ color: theme.node.muted }}>
                                                           {profile.notes}
                                                       </span>
                                                   ) : null}
                                               </button>
                                           ))}
                                       </div>
                                   ) : null}
                                   <div className="thin-scrollbar max-h-44 space-y-1 overflow-y-auto pr-1">
                                       {availableLoras.map((lora) => (
                                          <button
                                              key={lora.key}
                                              type="button"
                                              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition hover:opacity-80"
                                              style={{ borderColor: loras.includes(lora.key) ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                               onClick={() => toggleLora(lora.key)}
                                           >
                                               <span className="min-w-0">
                                                   <span className="block truncate text-xs">
                                                       {lora.label}
                                                       {recommendedSet.has(lora.key) ? <span className="ml-1 rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">推荐</span> : null}
                                                   </span>
                                                  {lora.style ? (
                                                      <span className="block truncate text-[10px]" style={{ color: theme.node.muted }}>
                                                          {lora.style}
                                                      </span>
                                                  ) : null}
                                              </span>
                                              {loras.includes(lora.key) ? <span className="shrink-0 text-xs">✓</span> : null}
                                          </button>
                                      ))}
                                      {!availableLoras.length ? (
                                          <div className="text-[11px]" style={{ color: theme.node.muted }}>
                                              当前模型没有兼容的 LoRA
                                          </div>
                                      ) : null}
                                  </div>
                              </div>
                          </>
                      ) : null}
                  </div>,
                  document.body,
              )
            : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button
                    size="small"
                    type="text"
                    className={buttonClassName || "!h-8 !max-w-[190px] !justify-start !rounded-full !px-2.5"}
                    style={{ background: theme.node.fill, color: theme.node.text }}
                    icon={<Wand2 className="size-3.5" />}
                    onClick={() => setOpen(!open)}
                >
                    <span className="truncate">{summary}</span>
                </Button>
            </span>
            {panel}
        </>
    );
}
