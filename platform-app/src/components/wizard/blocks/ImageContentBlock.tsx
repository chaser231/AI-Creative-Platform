import { useState, useRef } from "react";
import { Image as ImageIcon, Upload, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ImageComponentProps, BusinessUnit } from "@/types";
import { getSystemPromptForBU } from "@/services/aiService";

interface ImageContentBlockProps {
    id: string;
    name: string;
    props: ImageComponentProps;
    value: string;
    onChange: (value: string) => void;
    businessUnit?: BusinessUnit;
    productDescription?: string;
}

export function ImageContentBlock({ id, name, props, value, onChange, businessUnit, productDescription }: ImageContentBlockProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) {
                    onChange(ev.target.result as string);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handleGenerateImage = async () => {
        if (!productDescription) return;
        setIsGenerating(true);
        try {
            const stylePrompt = businessUnit ? getSystemPromptForBU(businessUnit, "image") : "";
            const finalPrompt = `${stylePrompt} Объект: ${productDescription}`;
            
            // Note: Since generating real images costs time/quota, this might just use a mock or prompt the API.
            const response = await fetch("/api/ai/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: finalPrompt,
                    type: "image",
                    model: "dall-e" // or whatever we use
                })
            });
            const data = await response.json();
            if (data.content) {
                onChange(data.content);
            }
        } catch (e) {
            console.error("Failed to generate image:", e);
            // Fallback for dev: set a placeholder
            onChange(`https://placehold.co/800x800/e2e8f0/1e293b.png?text=AI+Generated+Image`);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="p-4 bg-bg-primary border border-border-primary rounded-[var(--radius-lg)] shadow-sm">
            <div className="flex justify-between items-center mb-3">
                <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <ImageIcon size={16} className="text-text-secondary" />
                    {name}
                </label>
            </div>
            
            <div className="flex gap-4">
                {/* Preview Thumbnail */}
                <div className="w-24 h-24 shrink-0 rounded-[var(--radius-md)] border border-border-primary overflow-hidden bg-bg-secondary flex items-center justify-center relative">
                    {value || props.src ? (
                        <img 
                            src={value || props.src} 
                            alt={name} 
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <ImageIcon size={24} className="text-text-tertiary" />
                    )}
                </div>

                {/* Actions */}
                <div className="flex-1 flex flex-col gap-2">
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                    />
                    <Button 
                        variant="secondary" 
                        className="w-full justify-start text-sm h-9" 
                        icon={<Upload size={16} />}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        Загрузить файл
                    </Button>
                    
                    <Button 
                        variant="secondary" 
                        className="w-full justify-start text-sm h-9 border-purple-100 text-purple-600 hover:bg-purple-50 bg-purple-50/50" 
                        icon={<Wand2 size={16} className="text-purple-500" />}
                        onClick={handleGenerateImage}
                        disabled={isGenerating || !productDescription}
                    >
                        {isGenerating ? "Создание мокапа..." : "Генерировать AI"}
                    </Button>
                </div>
            </div>
            
            {businessUnit && (
                <div className="mt-3 flex items-center gap-1.5 text-[10px] text-text-tertiary border-t border-border-secondary pt-2">
                    <Sparkles size={10} className="text-purple-400" />
                    <span>Стиль генерации: {businessUnit === 'yandex-market' ? "Студийный свет, яркий фон" : "Кастомный пресет BU"}</span>
                </div>
            )}
        </div>
    );
}
