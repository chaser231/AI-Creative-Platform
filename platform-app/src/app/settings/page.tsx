"use client";

import { Sun, Moon, Monitor } from "lucide-react";
import { useThemeStore, type ThemeMode } from "@/store/themeStore";
import { AppShell } from "@/components/layout/AppShell";
import Link from "next/link";
import { useEffect, useState } from "react";

const themeOptions: { id: ThemeMode; label: string; icon: React.ReactNode; description: string }[] = [
    { id: "light", label: "Светлая", icon: <Sun size={20} />, description: "Тёплая кремовая палитра" },
    { id: "dark", label: "Тёмная", icon: <Moon size={20} />, description: "Тёмная тема для работы ночью" },
    { id: "system", label: "Системная", icon: <Monitor size={20} />, description: "Следует настройкам ОС" },
];

export default function SettingsPage() {
    const { theme, setTheme } = useThemeStore();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        // eslint-disable-next-line
        setMounted(true);
    }, []);

    const currentTheme = mounted ? theme : undefined;

    return (
        <AppShell>
            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-2xl mx-auto">
                    <h1 className="text-2xl font-light text-text-primary mb-1">Настройки</h1>
                    <p className="text-sm text-text-secondary mb-8">
                        Общие настройки платформы
                    </p>

                    {/* Theme Toggle */}
                    <section className="mb-8">
                        <h2 className="text-sm font-medium text-text-primary mb-4">Тема оформления</h2>
                        <div className="grid grid-cols-3 gap-3">
                            {themeOptions.map((option) => (
                                <button
                                    key={option.id}
                                    onClick={() => setTheme(option.id)}
                                    className={`
                                        flex flex-col items-center gap-3 p-5 rounded-[var(--radius-xl)] border transition-all cursor-pointer
                                        ${currentTheme === option.id
                                            ? "bg-bg-tertiary border-accent-primary shadow-[var(--shadow-md)]"
                                            : "bg-bg-surface border-border-primary hover:border-border-secondary hover:shadow-[var(--shadow-sm)]"
                                        }
                                    `}
                                >
                                    <span className={currentTheme === option.id ? "text-accent-primary" : "text-text-secondary"}>
                                        {option.icon}
                                    </span>
                                    <div className="text-center">
                                        <p className={`text-sm font-medium ${currentTheme === option.id ? "text-text-primary" : "text-text-secondary"}`}>
                                            {option.label}
                                        </p>
                                        <p className="text-[11px] text-text-tertiary mt-0.5">
                                            {option.description}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Links to other settings */}
                    <section>
                        <h2 className="text-sm font-medium text-text-primary mb-4">Другие настройки</h2>
                        <div className="space-y-3">
                            <Link
                                href="/settings/brand-kit"
                                className="flex items-center gap-3 p-4 rounded-[var(--radius-lg)] border border-border-primary bg-bg-surface hover:bg-bg-secondary transition-colors"
                            >
                                <div className="w-10 h-10 rounded-[var(--radius-md)] bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center">
                                    <span className="text-white text-lg">🎨</span>
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-text-primary">Бренд-кит</p>
                                    <p className="text-xs text-text-secondary">Цвета, типографика, тон коммуникации</p>
                                </div>
                            </Link>
                            <Link
                                href="/settings/styles"
                                className="flex items-center gap-3 p-4 rounded-[var(--radius-lg)] border border-border-primary bg-bg-surface hover:bg-bg-secondary transition-colors"
                            >
                                <div className="w-10 h-10 rounded-[var(--radius-md)] bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center">
                                    <span className="text-white text-lg">✨</span>
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-text-primary">AI Стили генерации</p>
                                    <p className="text-xs text-text-secondary">Кастомные стили для изображений и текста</p>
                                </div>
                            </Link>
                        </div>
                    </section>
                </div>
            </div>
        </AppShell>
    );
}
