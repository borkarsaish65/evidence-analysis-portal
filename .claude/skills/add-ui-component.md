# Skill: Add UI Component (ShadCN-style Primitive)

Add a new reusable UI primitive to `src/components/ui/`. These components are purely presentational — no API calls, no Context access, no page-level state.

## Before You Create: Check What Exists

```
src/components/ui/
├── button.jsx     CVA variants: default, destructive, outline, ghost, link, secondary
├── card.jsx       Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
├── input.jsx      Styled text input (forwardRef)
├── label.jsx      Form label with Radix UI
└── alert.jsx      Alert with destructive variant, AlertDescription
```

**Only create a new primitive if:**
1. None of the above covers your case
2. The component will be used in 3+ places across the codebase
3. It represents a genuinely reusable pattern, not a one-off layout

For one-off elements, inline Tailwind classes in the page component. Don't extract prematurely.

## Template A: Component with CVA Variants

Use when the component has distinct visual variants (like Button, Alert):

```jsx
// src/components/ui/badge.jsx
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  // Base classes — applied to all variants
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:     'border-transparent bg-primary text-primary-foreground',
        secondary:   'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline:     'text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Badge({ className, variant, ...props }) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
```

## Template B: Simple Component (no CVA)

Use when the component has no variants — just consistent styling:

```jsx
// src/components/ui/separator.jsx
import { cn } from '../../lib/utils';

function Separator({ className, orientation = 'horizontal', decorative = true, ...props }) {
  return (
    <div
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
      {...props}
    />
  );
}

export { Separator };
```

## Template C: DOM-wrapping Component (requires forwardRef)

Use whenever the component wraps an interactive DOM element that consumers may need a ref for:

```jsx
// src/components/ui/textarea.jsx
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Textarea = forwardRef(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
        'ring-offset-background placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'resize-none',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
```

## Template D: Compound Component (Card-style)

Use when a component has named sub-parts that compose together:

```jsx
// src/components/ui/dialog.jsx
import { cn } from '../../lib/utils';

function Dialog({ className, ...props }) {
  return (
    <div
      className={cn('fixed inset-0 z-50 flex items-center justify-center', className)}
      {...props}
    />
  );
}

function DialogContent({ className, ...props }) {
  return (
    <div
      className={cn('w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg', className)}
      {...props}
    />
  );
}

function DialogHeader({ className, ...props }) {
  return (
    <div className={cn('flex flex-col space-y-1.5 pb-4', className)} {...props} />
  );
}

function DialogTitle({ className, ...props }) {
  return (
    <h2 className={cn('text-lg font-semibold text-slate-800', className)} {...props} />
  );
}

export { Dialog, DialogContent, DialogHeader, DialogTitle };
```

## Rules — Non-negotiable

1. **Always accept and spread `className`** — consumers must be able to override styles.
2. **Always spread `...props`** — consumers must be able to add event handlers, `data-*`, ARIA attributes.
3. **Use `cn()` for all className composition** — never string concatenation.
4. **Use `forwardRef` for DOM-wrapping components** — anything wrapping `input`, `button`, `textarea`, `select`, `a`.
5. **Set `displayName`** on all `forwardRef` components — improves React DevTools.
6. **Export the CVA function separately** — `export { Badge, badgeVariants }` — consumers can use the variants function without rendering the component.
7. **No API calls** inside UI components.
8. **No `useContext`** inside UI components (not even `useAuth()`).
9. **No page-level `useState`** — only display-state is acceptable (e.g., `isOpen` for a tooltip).
10. **Use semantic color tokens** — `bg-primary`, `text-muted-foreground`, `border-border` — not raw palette colors.

## Naming Conventions

```
File:               src/components/ui/my-component.jsx   (kebab-case)
Component name:     MyComponent                           (PascalCase)
CVA export name:    myComponentVariants                   (camelCase + "Variants")
displayName value:  'MyComponent'                         (PascalCase string)
```

## When to Use Which Template

| Situation | Template |
|-----------|----------|
| Multiple visual variants needed | A (CVA) |
| Single visual style, no interactive DOM element | B (simple) |
| Wraps `input`, `textarea`, `select`, `button` | C (forwardRef) |
| Has named sub-parts (header, content, footer) | D (compound) |

## Anti-patterns

❌ API calls or data fetching inside a UI component
❌ `useAuth()`, `useContext(AuthContext)`, or any global state access
❌ `useState` for data (only OK for display state: `isOpen`, `isHovered`)
❌ Hardcoded colors instead of CSS custom properties
❌ Not accepting `className` prop (blocks consumers)
❌ Not spreading `...props` (blocks consumers from adding attributes)
❌ Creating a new primitive for something already covered by `button.jsx`, `card.jsx`, `input.jsx`
❌ Using `style={{}}` for anything expressible in Tailwind
