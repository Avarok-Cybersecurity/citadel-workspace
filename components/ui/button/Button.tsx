import clsx from 'clsx';
import React, {
  forwardRef,
  ReactElement,
  ForwardRefRenderFunction,
} from 'react';

type ButtonVariant = 'contained' | 'outline';
type ButtonColor = 'blue' | 'darkblue';
type ButtonSize = 'xsmall' | 'small' | 'medium' | 'large';

export type ButtonProps = {
  children: ReactElement;
  variant?: ButtonVariant;
  size?: ButtonSize;
  color?: ButtonColor;
  [key: string]: unknown;
};

const ButtonRender: ForwardRefRenderFunction<HTMLElement, ButtonProps> = (
  props,
  ref
) => {
  const { children, variant, size, color, className, ...rest } = props;
  const child = React.Children.only(children);

  const _color: ButtonColor = color ?? 'blue';
  const _variant: ButtonVariant = variant ?? 'contained';
  const _size: ButtonSize = size ?? 'medium';

  return React.cloneElement(child, {
    ...rest,
    ref,
    className: clsx(
      className as string,
      'inline-block text-center outline-none focus:outline-none',
      'rounded-md border-2',
      buttonSize[_size],
      colorVariant[_color][_variant],
      child.props.className
    ),
  });
};

export const Button = forwardRef(ButtonRender);

const buttonSize = {
  xsmall: 'px-2 py-1.5 text-xs font-medium',
  small: 'px-6 py-2 text-sm font-medium',
  medium: 'px-8 py-3 text-base font-semibold',
  large: 'px-8 py-4 font-semibold',
};

const colorVariant: Record<ButtonColor, Record<ButtonVariant, string>> = {
  blue: {
    contained: [
      'border-blue-500 bg-blue-500 text-white',
      'hover:border-blue-400 hover:bg-blue-400',
      'active:border-blue-600 active:bg-blue-600',
    ].join(' '),

    outline: [
      'border-blue-500 text-blue-500',
      'hover:border-blue-400 hover:text-blue-400',
      'active:border-blue-500 active:text-blue-500 active:bg-blue-200',
    ].join(' '),
  },

  darkblue: {
    contained: [
      'border-blue-800 bg-blue-800 text-white',
      'hover:border-blue-700 hover:bg-blue-700',
      'active:border-blue-900 active:bg-blue-900',
    ].join(' '),

    outline: [
      'border-blue-800 text-blue-800',
      'hover:border-blue-700 hover:text-blue-700',
      'active:border-blue-900 active:text-blue-900 active:bg-blue-300',
    ].join(' '),
  },
};

export default Button;
