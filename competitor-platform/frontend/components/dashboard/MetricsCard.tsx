import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";

interface MetricsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  className?: string;
}

export function MetricsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendLabel,
  className,
}: MetricsCardProps) {
  return (
    <div className={clsx("bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <span className="p-2 bg-brand-50 rounded-lg">
          <Icon size={18} className="text-brand-600" />
        </span>
      </div>

      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>

      {trendLabel && (
        <p
          className={clsx("text-xs font-medium", {
            "text-green-600": trend === "up",
            "text-red-500": trend === "down",
            "text-gray-500": trend === "neutral",
          })}
        >
          {trendLabel}
        </p>
      )}
    </div>
  );
}
