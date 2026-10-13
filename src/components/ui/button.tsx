import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-pill font-sans font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Primary pill: olive fill
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        // Outline pill
        outline: 'bg-transparent text-foreground shadow-[inset_0_0_0_1.5px_rgb(var(--line))] hover:bg-surface-200',
        // Quiet fill, for switches and secondary controls
        secondary: 'bg-surface-100 text-foreground hover:bg-surface-200',
        ghost: 'text-ink-muted hover:bg-surface-100 hover:text-foreground',
        // The end-session button: paper fill, never alert red
        end: 'bg-ink text-surface-000 hover:bg-ink/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-[46px] px-[22px] text-label',
        sm: 'h-9 px-4 text-small',
        lg: 'h-[58px] px-[30px] text-[17px]',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = 'Button';

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants };
