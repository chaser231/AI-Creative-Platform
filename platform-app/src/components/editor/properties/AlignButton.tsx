"use client";

export function AlignButton({
    icon,
    isActive,
    onClick,
    title,
}: {
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
    title: string;
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            className={`p-1.5 transition-colors cursor-pointer ${isActive
                ? "bg-accent-primary/10 text-accent-primary"
                : "text-text-tertiary hover:text-text-primary hover:bg-bg-secondary"
                }`}
        >
            {icon}
        </button>
    );
}
