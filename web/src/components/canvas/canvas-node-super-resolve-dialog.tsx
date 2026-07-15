import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Segmented, Spin } from "antd";
import { Sparkles } from "lucide-react";

import { readImageMeta } from "@/lib/image-utils";
import { fetchUpscaleModels, findComfyGatewayBase, type UpscaleModelOption } from "@/services/api/comfy";
import { useEffectiveConfig } from "@/stores/use-config-store";

export type CanvasImageSuperResolveParams = {
    model: string;
};

export function CanvasNodeSuperResolveDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageSuperResolveParams) => void }) {
    const config = useEffectiveConfig();
    const gatewayBase = useMemo(() => findComfyGatewayBase(config), [config]);
    const [models, setModels] = useState<UpscaleModelOption[]>([]);
    const [model, setModel] = useState("");
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);

    useEffect(() => {
        if (!open) return;
        setImage(null);
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) return;
        if (!gatewayBase) {
            setLoadError("未找到本地 ComfyUI 网关渠道，请先在设置里添加 comfy/ 模型渠道");
            return;
        }
        setLoading(true);
        setLoadError("");
        fetchUpscaleModels(gatewayBase)
            .then((options) => {
                setModels(options);
                setModel((current) => (options.some((option) => option.name === current) ? current : options[0]?.name || ""));
                if (!options.length) setLoadError("ComfyUI 未安装超分模型（models/upscale_models 为空）");
            })
            .catch((error) => setLoadError(error instanceof Error ? error.message : "读取超分模型失败"))
            .finally(() => setLoading(false));
    }, [gatewayBase, open]);

    const MAX_OUTPUT_LONG_EDGE = 16384;
    const sourceLongEdge = image ? Math.max(image.width, image.height) : 0;
    const modelDisabled = (option: UpscaleModelOption) => Boolean(image && sourceLongEdge * option.scale > MAX_OUTPUT_LONG_EDGE);
    const selected = models.find((option) => option.name === model);
    const selectedUsable = selected && !modelDisabled(selected);
    const outputSize = image && selected ? { width: image.width * selected.scale, height: image.height * selected.scale } : null;

    useEffect(() => {
        if (!image || !models.length) return;
        setModel((current) => {
            const currentOption = models.find((option) => option.name === current);
            if (currentOption && !modelDisabled(currentOption)) return current;
            return models.find((option) => !modelDisabled(option))?.name || current;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [image, models]);

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={820} centered destroyOnHidden>
            <div className="space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">AI 超分</h2>
                    <p className="mt-1 text-sm opacity-60">使用本地 ComfyUI 超分模型放大图片，保留细节不糊图</p>
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
                    <div className="rounded-xl border p-4">
                        <div className="grid min-h-[280px] place-items-center rounded-lg bg-black/5">
                            <img src={dataUrl} alt="" className="max-h-[320px] max-w-full rounded-lg object-contain shadow-xl" draggable={false} />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="opacity-60">源图</span>
                            <span className="font-semibold">{image ? `${image.width} x ${image.height} px` : "读取中"}</span>
                        </div>
                    </div>
                    <div className="space-y-6 py-2">
                        <div className="space-y-2">
                            <div className="font-medium opacity-75">超分模型</div>
                            {loading ? (
                                <div className="grid min-h-24 place-items-center"><Spin /></div>
                            ) : models.length ? (
                                <Segmented
                                    block
                                    vertical
                                    value={model}
                                    options={models.map((option) => ({
                                        value: option.name,
                                        disabled: modelDisabled(option),
                                        label: (
                                            <span className="flex min-h-10 flex-col justify-center text-left leading-5">
                                                <span className="font-medium">{option.name.replace(/\.(safetensors|pth)$/i, "")}</span>
                                                <span className="text-xs opacity-55">{option.scale}x 放大</span>
                                            </span>
                                        ),
                                    }))}
                                    onChange={(value) => setModel(String(value))}
                                />
                            ) : null}
                            {loadError ? <div className="text-xs font-medium text-[#ef4444]">{loadError}</div> : null}
                            {image && models.length && !models.some((option) => !modelDisabled(option)) ? (
                                <div className="text-xs font-medium text-[#ef4444]">图片已经很大，继续超分会超过 16K 像素上限，无需再超分</div>
                            ) : null}
                        </div>
                        <div className="rounded-xl border px-4 py-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="opacity-60">输出尺寸</span>
                                <span className="font-semibold">{outputSize ? `${outputSize.width} x ${outputSize.height} px` : "未知"}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button type="primary" size="large" icon={<Sparkles className="size-4" />} disabled={!selectedUsable} onClick={() => selectedUsable && onConfirm({ model: selected.name })}>
                        开始超分
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
