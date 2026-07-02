import { cn } from "@/lib/utils";

/** Simple accessible progress indicator for the onboarding flow. */
export function OnboardingSteps({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  return (
    <ol
      className="mb-6 flex items-center gap-2"
      aria-label={`Onboarding progress: step ${current + 1} of ${steps.length}`}
    >
      {steps.map((label, index) => (
        <li key={label} className="flex flex-1 flex-col gap-1.5">
          <span
            className={cn(
              "h-1.5 rounded-full",
              index <= current ? "bg-primary" : "bg-muted",
            )}
            aria-hidden="true"
          />
          <span
            className={cn(
              "text-xs",
              index === current
                ? "font-medium text-foreground"
                : "text-muted-foreground",
            )}
            aria-current={index === current ? "step" : undefined}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}
