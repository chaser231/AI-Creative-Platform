"use client";

/**
 * /settings/ai — AI Configuration Hub
 *
 * Sections:
 * 1. Default Models — pick preferred image/text generation models
 * 2. API Keys — BYOK support for OpenAI, Replicate (display-only, future editing)
 * 3. AI Styles link — points to the full /settings/styles CRUD page
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Sparkles, Cpu, Key, Palette, ChevronRight,
  Check, Info, Eye, EyeOff, ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { MODEL_REGISTRY, type ModelEntry } from "@/lib/ai-models";

// ─── Constants ──────────────────────────────────────────────────────────────

const IMAGE_MODELS = MODEL_REGISTRY.filter(m => m.caps.includes("generate"));
const TEXT_MODELS = MODEL_REGISTRY.filter(m => m.caps.includes("text"));

const LS_DEFAULT_IMAGE_MODEL = "acp_default_image_model";
const LS_DEFAULT_TEXT_MODEL = "acp_default_text_model";

// ─── Component ──────────────────────────────────────────────────────────────

export default function AISettingsPage() {
  const [mounted, setMounted] = useState(false);
  const [defaultImageModel, setDefaultImageModel] = useState("nano-banana-2");
  const [defaultTextModel, setDefaultTextModel] = useState("deepseek");
  const [showReplicateKey, setShowReplicateKey] = useState(false);
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [savedModel, setSavedModel] = useState<string | null>(null);

  // Load saved defaults from localStorage
  useEffect(() => {
    setMounted(true);
    const savedImg = localStorage.getItem(LS_DEFAULT_IMAGE_MODEL);
    const savedTxt = localStorage.getItem(LS_DEFAULT_TEXT_MODEL);
    if (savedImg) setDefaultImageModel(savedImg);
    if (savedTxt) setDefaultTextModel(savedTxt);
  }, []);

  const handleModelChange = (type: "image" | "text", modelId: string) => {
    if (type === "image") {
      setDefaultImageModel(modelId);
      localStorage.setItem(LS_DEFAULT_IMAGE_MODEL, modelId);
    } else {
      setDefaultTextModel(modelId);
      localStorage.setItem(LS_DEFAULT_TEXT_MODEL, modelId);
    }
    setSavedModel(type);
    setTimeout(() => setSavedModel(null), 1500);
  };

  const getModelInfo = (model: ModelEntry) => {
    const capsLabels: Record<string, string> = {
      generate: "Генерация",
      edit: "Редактирование",
      "remove-bg": "Удаление фона",
      vision: "Vision",
      text: "Текст",
      inpaint: "Inpaint",
      outpaint: "Outpaint",
    };
    return model.caps.map(c => capsLabels[c] || c).join(" · ");
  };

  return (
    <AppShell>
      <TopBar
        breadcrumbs={[{ label: "Настройки" }, { label: "AI Конфигурация" }]}
        showBackToProjects={false}
        showHistoryNavigation={true}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-10">

          {/* Header */}
          <div>
            <h1 className="text-2xl font-light text-text-primary mb-1 flex items-center gap-2.5">
              <Sparkles size={22} className="text-accent-primary" />
              Настройки AI
            </h1>
            <p className="text-sm text-text-secondary">
              Модели по умолчанию, API-ключи и стили генерации
            </p>
          </div>

          {/* ═══════════════════════════════════════════════ */}
          {/* DEFAULT MODELS */}
          {/* ═══════════════════════════════════════════════ */}
          <section>
            <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
              <Cpu size={16} className="text-text-tertiary" />
              Модели по умолчанию
            </h2>
            <p className="text-xs text-text-tertiary mb-4">
              Выбранные модели будут использоваться по умолчанию при создании нового проекта
            </p>

            <div className="space-y-6">
              {/* Image Model */}
              <div>
                <label className="text-xs text-text-secondary mb-2 block font-medium">
                  🖼️ Генерация изображений
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {IMAGE_MODELS.map(model => {
                    const isSelected = mounted && defaultImageModel === model.id;
                    return (
                      <button
                        key={model.id}
                        onClick={() => handleModelChange("image", model.id)}
                        className={`
                          flex items-center gap-3 p-3 rounded-[var(--radius-lg)] border transition-all cursor-pointer text-left
                          ${isSelected
                            ? "border-accent-primary bg-accent-primary/5 shadow-sm"
                            : "border-border-primary bg-bg-surface hover:border-border-secondary hover:bg-bg-secondary"
                          }
                        `}
                      >
                        <div className={`
                          w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
                          ${isSelected ? "border-accent-primary bg-accent-primary" : "border-border-secondary"}
                        `}>
                          {isSelected && <Check size={10} className="text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${isSelected ? "text-text-primary" : "text-text-secondary"}`}>
                              {model.label}
                            </span>
                            {model.byok && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                                BYOK
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-text-tertiary">
                            {getModelInfo(model)} · ${model.costPerRun}/run
                          </span>
                        </div>
                        {isSelected && savedModel === "image" && (
                          <span className="text-[11px] text-accent-primary font-medium animate-in fade-in">Сохранено ✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Text Model */}
              <div>
                <label className="text-xs text-text-secondary mb-2 block font-medium">
                  ✍️ Генерация текста
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {TEXT_MODELS.map(model => {
                    const isSelected = mounted && defaultTextModel === model.id;
                    return (
                      <button
                        key={model.id}
                        onClick={() => handleModelChange("text", model.id)}
                        className={`
                          flex items-center gap-3 p-3 rounded-[var(--radius-lg)] border transition-all cursor-pointer text-left
                          ${isSelected
                            ? "border-accent-primary bg-accent-primary/5 shadow-sm"
                            : "border-border-primary bg-bg-surface hover:border-border-secondary hover:bg-bg-secondary"
                          }
                        `}
                      >
                        <div className={`
                          w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
                          ${isSelected ? "border-accent-primary bg-accent-primary" : "border-border-secondary"}
                        `}>
                          {isSelected && <Check size={10} className="text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm font-medium ${isSelected ? "text-text-primary" : "text-text-secondary"}`}>
                            {model.label}
                          </span>
                          <span className="text-[11px] text-text-tertiary ml-2">
                            ${model.costPerRun}/run
                          </span>
                        </div>
                        {isSelected && savedModel === "text" && (
                          <span className="text-[11px] text-accent-primary font-medium animate-in fade-in">Сохранено ✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════ */}
          {/* API KEYS */}
          {/* ═══════════════════════════════════════════════ */}
          <section>
            <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
              <Key size={16} className="text-text-tertiary" />
              API-ключи
            </h2>
            <div className="p-4 rounded-[var(--radius-lg)] border border-blue-200 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-950/20 mb-4">
              <div className="flex gap-2.5">
                <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">Серверные ключи</p>
                  <p className="text-[11px] text-blue-600/80 dark:text-blue-400/80 mt-0.5">
                    API-ключи настраиваются администратором платформы в серверных переменных окружения.
                    Здесь отображается статус подключения провайдеров.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {/* Replicate */}
              <div className="p-4 rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-[var(--radius-md)] bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">R</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">Replicate</p>
                      <p className="text-[11px] text-text-tertiary">Большинство моделей генерации</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-emerald-500" />
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Подключён</span>
                  </div>
                </div>
              </div>

              {/* OpenAI */}
              <div className="p-4 rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-[var(--radius-md)] bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">AI</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">OpenAI</p>
                      <p className="text-[11px] text-text-tertiary">DALL-E 3, GPT Image (BYOK)</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-emerald-500" />
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Подключён</span>
                  </div>
                </div>
              </div>

              {/* S3 Storage */}
              <div className="p-4 rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-[var(--radius-md)] bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">S3</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">Yandex Cloud S3</p>
                      <p className="text-[11px] text-text-tertiary">Хранилище ассетов и превью</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-emerald-500" />
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Подключён</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ═══════════════════════════════════════════════ */}
          {/* AI STYLES LINK */}
          {/* ═══════════════════════════════════════════════ */}
          <section className="pb-8">
            <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
              <Palette size={16} className="text-text-tertiary" />
              Стили генерации
            </h2>
            <Link
              href="/settings/styles"
              className="flex items-center gap-4 p-5 rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface hover:bg-bg-secondary hover:border-border-secondary transition-all group"
            >
              <div className="w-12 h-12 rounded-[var(--radius-lg)] bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center shrink-0">
                <Palette size={22} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">AI Стили генерации</p>
                <p className="text-xs text-text-secondary mt-0.5">
                  Кастомные пресеты стилей для изображений и текста. Создавайте, редактируйте и управляйте стилями вашего воркспейса.
                </p>
              </div>
              <ChevronRight size={18} className="text-text-tertiary group-hover:text-text-primary transition-colors shrink-0" />
            </Link>
          </section>

        </div>
      </div>
    </AppShell>
  );
}
