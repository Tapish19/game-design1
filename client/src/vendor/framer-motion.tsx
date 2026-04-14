import React from "react";

type Props = React.PropsWithChildren<Record<string, unknown>>;

const MOTION_ONLY_PROPS = new Set([
  "animate",
  "exit",
  "initial",
  "layout",
  "transition",
  "variants",
  "whileTap",
  "whileHover",
  "whileFocus",
  "whileDrag",
]);

function stripMotionProps(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (MOTION_ONLY_PROPS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

const passthrough = (tag: string) =>
  function MotionTag({ children, ...rest }: Props) {
    return React.createElement(tag, stripMotionProps(rest), children);
  };

export const motion = new Proxy({} as Record<string, React.ComponentType<Props>>, {
  get: (_, tag: string) => passthrough(tag),
});

export function AnimatePresence({ children }: Props) {
  return <>{children}</>;
}