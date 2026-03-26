import { useReducedMotion } from 'framer-motion';

/**
 * Returns motion variants that respect prefers-reduced-motion.
 * When reduced motion is preferred, all animations are instant (no delay, no spring).
 */
export function useMotionPreference() {
    const shouldReduce = useReducedMotion();
    return {
        shouldReduce,
        fadeIn: shouldReduce
            ? { initial: {}, animate: {}, transition: {} }
            : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3 } },
    };
}
