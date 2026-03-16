import { useState } from "react";
import { Sparkles, Type } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { TextComponentProps } from "@/types";
import { getSystemPromptForBU } from "@/services/aiService";
import type { BusinessUnit } from "@/types";

interface TextContentBlockProps {
    id: string;
    name: string;
    props: TextComponentProps;
    value: string;
    onChange: (value: string) => void;
    businessUnit?: BusinessUnit;
    productDescription?: string;
}

export function TextContentBlock({ id, name, props, value, onChange, businessUnit, productDescription }: TextContentBlockProps) {
    const [isGenerating, setIsGenerating] = useState(false);

    const handleMagicFill = async () => {
        if (!productDescription) return;
        setIsGenerating(true);
        try {
            const sysPrompt = businessUnit ? getSystemPromptForBU(businessUnit, "text") : "";
            const response = await fetch("/api/ai/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: `${sysPrompt}\n\nСгенерируй короткий текст для элемента "${name}" основываясь на этом описании: ${productDescription}. Ответь ТОЛЬКО текстом самого элемента без кавычек и пояснений.`,
                    type: "text",
                    model: "openai"
                })
            });
            const data = await response.json();
            if (data.content) {
                onChange(data.content);
            }
        } catch (e) {
            console.error("Failed to generate text:", e);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="p-4 bg-bg-primary border border-border-primary rounded-[var(--radius-lg)] shadow-sm">
            <div className="flex justify-between items-center mb-2">
                <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Type size={16} className="text-text-secondary" />
                    {name}
                </label>
                {productDescription && (
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        icon={<Sparkles size={14} className="text-purple-500" />}
                        onClick={handleMagicFill}
                        disabled={isGenerating}
                        className="text-xs h-7 px-2 hover:bg-purple-50 text-purple-600 border border-purple-100"
                    >
                        {isGenerating ? "Генерация..." : "Magic Fill"}
                    </Button>
                )}
            </div>
            <input
                type="text"
                placeholder={props.text || "Введите текст"}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
            />
            {businessUnit && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-text-tertiary">
                    <Sparkles size={10} />
                    <span>Умное автозаполнение адаптивно под {businessUnit}</span>
                </div>
            )}
        </div>
    );
}
