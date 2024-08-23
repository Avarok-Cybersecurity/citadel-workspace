import React from 'react';
import clsx from 'clsx';

const classes = 'px-5 max-w-full';

export function Column(props: JSX.IntrinsicElements['div']) {
  const { className, ...rest } = props;
  return <div className={clsx(classes, className)} {...rest} />;
}
