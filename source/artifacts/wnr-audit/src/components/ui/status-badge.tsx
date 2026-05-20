import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { FindingStatus } from "@workspace/api-client-react";

const statusVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      status: {
        [FindingStatus.open]:
          "bg-warning/15 text-warning border border-warning/20",
        [FindingStatus.ignored]:
          "bg-muted text-muted-foreground border border-border",
        [FindingStatus.resolved]:
          "bg-success/15 text-success border border-success/20",
      },
    },
    defaultVariants: {
      status: FindingStatus.open,
    },
  }
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statusVariants> {
  status: FindingStatus;
}

export function StatusBadge({ className, status, ...props }: StatusBadgeProps) {
  const labels: Record<FindingStatus, string> = {
    [FindingStatus.open]: "Aberta",
    [FindingStatus.ignored]: "Ignorada",
    [FindingStatus.resolved]: "Resolvida",
  };

  return (
    <div className={cn(statusVariants({ status }), className)} {...props}>
      {labels[status]}
    </div>
  );
}
