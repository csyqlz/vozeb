import type { ComponentProps } from "react";
import { Sparkles } from "lucide-react";

export function CreditSymbol({ className, ...props }: ComponentProps<"span">) {
    return (
        <span {...props} className={`inline-flex items-center justify-center ${className || ""}`}>
            <Sparkles className="size-[1em]" strokeWidth={2.4} />
        </span>
    );
}

export type ModelCreditCost = {
    model: string;
    credits: number;
};

export const DEFAULT_MODEL_POINT_COST_KEY = "__default__";

function modelName(value: string) {
    const separator = value.indexOf("::");
    return separator >= 0 ? value.slice(separator + 2) : value;
}

function modelCreditCost(modelCosts: Record<string, number> | ModelCreditCost[] | undefined, model: string) {
    const name = modelName(model).trim();
    if (Array.isArray(modelCosts)) return modelCosts.find((item) => item.model === name)?.credits ?? 1;
    if (!modelCosts) return 1;
    const direct = modelCosts[name];
    if (direct !== undefined) return direct;
    const insensitiveKey = Object.keys(modelCosts).find((key) => key.toLowerCase() === name.toLowerCase());
    if (insensitiveKey) return modelCosts[insensitiveKey] ?? 1;
    return modelCosts[DEFAULT_MODEL_POINT_COST_KEY] ?? 1;
}

export function requestCreditCost(options: { apiSource?: "system" | "custom"; modelPointCosts?: Record<string, number>; modelCosts?: ModelCreditCost[]; model: string; count?: string | number }) {
    if (options.apiSource !== "system") return 0;
    const count = Math.max(1, Math.floor(Math.abs(Number(options.count)) || 1));
    return Math.ceil(modelCreditCost(options.modelPointCosts || options.modelCosts, options.model) * count);
}

export function creditCostLabel(cost: number) {
    return cost > 0 ? `消耗 ${cost.toLocaleString()} 积分` : "自定义接口不扣积分";
}
