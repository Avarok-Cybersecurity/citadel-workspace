import React from 'react';
import clsx from 'clsx';

const classes = 'flex flex-wrap -mx-5';

export function Row(props: JSX.IntrinsicElements['div']) {
  const { className, ...rest } = props;
  return <div className={clsx(classes, className)} {...rest} />;
}
