import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Severity } from "@workspace/api-client-react";

const severityVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      severity: {
        [Severity.critical]:
          "bg-destructive/15 text-destructive border border-destructive/20",
        [Severity.high]:
          "bg-orange-500/15 text-orange-600 dark:text-orange-500 border border-orange-500/20",
        [Severity.medium]:
          "bg-yellow-500/15 text-yellow-600 dark:text-yellow-500 border border-yellow-500/20",
        [Severity.low]:
          "bg-blue-500/15 text-blue-600 dark:text-blue-500 border border-blue-500/20",
        [Severity.info]:
          "bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/20",
      },
    },
    defaultVariants: {
      severity: Severity.info,
    },
  }
);

export interface SeverityBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof severityVariants> {
  severity: Severity;
}

export function SeverityBadge({ className, severity, ...props }: SeverityBadgeProps) {
  const labels: Record<Severity, string> = {
    [Severity.critical]: "Crítica",
    [Severity.high]: "Alta",
    [Severity.medium]: "Média",
    [Severity.low]: "Baixa",
    [Severity.info]: "Informativa",
  };

  return (
    <div className={cn(severityVariants({ severity }), className)} {...props}>
      {labels[severity]}
    </div>
  );
}
