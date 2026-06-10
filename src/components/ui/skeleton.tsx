import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shimmer rounded-md bg-[oklch(1_0_0_/_5%)]", className)}
      {...props}
    />
  );
}

export { Skeleton };
