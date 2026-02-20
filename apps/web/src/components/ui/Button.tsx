import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-devai-accent hover:bg-devai-accent-hover text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed',
  secondary:
    'bg-devai-card hover:bg-devai-card/80 border border-devai-border text-devai-text-secondary hover:text-devai-text disabled:opacity-50 disabled:cursor-not-allowed',
  danger:
    'bg-red-600 hover:bg-red-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed',
  ghost:
    'text-devai-text-secondary hover:text-devai-text disabled:opacity-50 disabled:cursor-not-allowed',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'text-xs px-3 py-1 rounded',
  md: 'text-sm px-4 py-2 rounded-xl',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`transition-colors ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
