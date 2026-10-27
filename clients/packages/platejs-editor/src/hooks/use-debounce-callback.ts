"use client";

import { useEffect, useMemo, useRef } from "react";

// https://github.com/xnimorz/use-debounce/blob/master/src/useDebouncedCallback.ts

export type CallOptions = {
  /**
   * Controls if the function should be invoked on the leading edge of the
   * timeout.
   */
  leading?: boolean;
  /**
   * Controls if the function should be invoked on the trailing edge of the
   * timeout.
   */
  trailing?: boolean;
};

export type ControlFunctions<ReturnT> = {
  /** Cancel pending function invocations */
  cancel: () => void;
  /** Immediately invoke pending function invocations */
  flush: () => ReturnT | undefined;
  /** Returns `true` if there are any pending function invocations */
  isPending: () => boolean;
};

/**
 * Subsequent calls to the debounced function return the result of the last func
 * invocation. Note, that if there are no previous invocations you will get
 * undefined. You should check it in your code properly.
 */
export type DebouncedState<T extends (...args: never[]) => unknown> = ((
  ...args: Parameters<T>
) => ReturnType<T> | undefined) &
  ControlFunctions<ReturnType<T>>;

export interface Options extends CallOptions {
  /**
   * If the setting is set to true, all debouncing and timers will happen on the
   * server side as well
   */
  debounceOnServer?: boolean;
  /**
   * The maximum time the given function is allowed to be delayed before it's
   * invoked.
   */
  maxWait?: number;
}

/**
 * Creates a debounced function that delays invoking `func` until after `wait`
 * milliseconds have elapsed since the last time the debounced function was
 * invoked, or until the next browser frame is drawn.
 *
 * The debounced function comes with a `cancel` method to cancel delayed `func`
 * invocations and a `flush` method to immediately invoke them.
 *
 * Provide `options` to indicate whether `func` should be invoked on the leading
 * and/or trailing edge of the `wait` timeout. The `func` is invoked with the
 * last arguments provided to the debounced function.
 *
 * Subsequent calls to the debounced function return the result of the last
 * `func` invocation.
 *
 * **Note:** If `leading` and `trailing` options are `true`, `func` is invoked
 * on the trailing edge of the timeout only if the debounced function is invoked
 * more than once during the `wait` timeout.
 *
 * If `wait` is `0` and `leading` is `false`, `func` invocation is deferred
 * until the next tick, similar to `setTimeout` with a timeout of `0`.
 *
 * If `wait` is omitted in an environment with `requestAnimationFrame`, `func`
 * invocation will be deferred until the next frame is drawn (typically about
 * 16ms).
 *
 * See [David Corbacho's
 * article](https://css-tricks.com/debouncing-throttling-explained-examples/)
 * for details over the differences between `debounce` and `throttle`.
 *
 * @category Function
 * @example
 *   // Avoid costly calculations while the window size is in flux.
 *   const resizeHandler = useDebouncedCallback(calculateLayout, 150);
 *   window.addEventListener('resize', resizeHandler)
 *
 *   // Invoke `sendMail` when clicked, debouncing subsequent calls.
 *   const clickHandler = useDebouncedCallback(sendMail, 300, {
 *   leading: true,
 *   trailing: false,
 *   })
 *   <button onClick={clickHandler}>click me</button>
 *
 *   // Ensure `batchLog` is invoked once after 1 second of debounced calls.
 *   const debounced = useDebouncedCallback(batchLog, 250, { 'maxWait': 1000 })
 *   const source = new EventSource('/stream')
 *   source.addEventListener('message', debounced)
 *
 *   // Cancel the trailing debounced invocation.
 *   window.addEventListener('popstate', debounced.cancel)
 *
 *   // Check for pending invocations.
 *   const status = debounced.pending() ? "Pending..." : "Ready"
 *
 * @param {Function} func The function to debounce.
 * @param {number} [wait=0] The number of milliseconds to delay; if omitted,
 *   `requestAnimationFrame` is used (if available, otherwise it will be
 *   setTimeout(...,0)). Default is `0`
 * @param {Object} [options={}] The options object. Controls if `func` should be
 *   invoked on the leading edge of the timeout. Default is `{}`
 * @param {boolean} [options.leading=false] The maximum time `func` is allowed
 *   to be delayed before it's invoked. Default is `false`
 * @param {number} [options.maxWait] Controls if `func` should be invoked the
 *   trailing edge of the timeout.
 * @param {boolean} [options.trailing=true] Default is `true`
 * @returns {Function} Returns the new debounced function.
 */
export function useDebouncedCallback<T extends (...args: never[]) => unknown>(
  func: T,
  wait?: number,
  options?: Options
): DebouncedState<T> {
  const lastCallTime = useRef<number | null>(null);
  const lastInvokeTime = useRef(0);
  const timerId = useRef<number | ReturnType<typeof setTimeout> | null>(null);
  const lastArgs = useRef<Parameters<T> | null>(null);
  const lastThis = useRef<unknown>(undefined);
  const result = useRef<ReturnType<T> | undefined>(undefined);
  const funcRef = useRef(func);
  const mounted = useRef(true);
  // Always keep the latest version of debounce callback, with no wait time.
  funcRef.current = func;

  const isClientSize = typeof window !== "undefined";
  const waitMs = wait ?? 0;
  const resolvedOptions = options ?? {};
  // Bypass `requestAnimationFrame` by explicitly setting `wait=0`.
  const useRAF = wait == null && isClientSize;

  if (typeof func !== "function") {
    throw new TypeError("Expected a function");
  }

  const leading = !!resolvedOptions.leading;
  const trailing =
    "trailing" in resolvedOptions ? !!resolvedOptions.trailing : true; // `true` by default
  const maxing = "maxWait" in resolvedOptions;
  const debounceOnServer =
    "debounceOnServer" in resolvedOptions
      ? !!resolvedOptions.debounceOnServer
      : false; // `false` by default
  const maxWait = maxing
    ? Math.max(resolvedOptions.maxWait || 0, waitMs)
    : null;

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  // You may have a question, why we have so many code under the useMemo definition.
  //
  // This was made as we want to escape from useCallback hell and
  // not to initialize a number of functions each time useDebouncedCallback is called.
  //
  // It means that we have less garbage for our GC calls which improves performance.
  // Also, it makes this library smaller.
  //
  // And the last reason, that the code without lots of useCallback with deps is easier to read.
  // You have only one place for that.
  const debounced = useMemo(() => {
    const invokeFunc = (time: number) => {
      const args = lastArgs.current;
      const thisArg = lastThis.current;

      if (!args) {
        return result.current;
      }

      lastArgs.current = null;
      lastThis.current = null;
      lastInvokeTime.current = time;

      result.current = funcRef.current.apply(thisArg, args) as ReturnType<T>;

      return result.current;
    };

    const startTimer = (pendingFunc: () => void, delayMs: number) => {
      if (useRAF) cancelAnimationFrame(timerId.current as number);

      timerId.current = useRAF
        ? requestAnimationFrame(pendingFunc)
        : setTimeout(pendingFunc, delayMs);
    };

    const shouldInvoke = (time: number) => {
      if (!mounted.current) return false;

      const timeSinceLastCall = time - (lastCallTime.current ?? 0);
      const timeSinceLastInvoke = time - lastInvokeTime.current;

      // Either this is the first call, activity has stopped and we're at the
      // trailing edge, the system time has gone backwards and we're treating
      // it as the trailing edge, or we've hit the `maxWait` limit.
      return (
        !lastCallTime.current ||
        timeSinceLastCall >= waitMs ||
        timeSinceLastCall < 0 ||
        (maxing && timeSinceLastInvoke >= (maxWait ?? 0))
      );
    };

    const trailingEdge = (time: number) => {
      timerId.current = null;

      // Only invoke if we have `lastArgs` which means `func` has been
      // debounced at least once.
      if (trailing && lastArgs.current) {
        return invokeFunc(time);
      }

      lastArgs.current = lastThis.current = null;

      return result.current;
    };

    const timerExpired = () => {
      const time = Date.now();

      if (shouldInvoke(time)) {
        return trailingEdge(time);
      }
      // https://github.com/xnimorz/use-debounce/issues/97
      if (!mounted.current) {
        return;
      }

      // Remaining wait calculation
      const timeSinceLastCall = time - (lastCallTime.current ?? 0);
      const timeSinceLastInvoke = time - lastInvokeTime.current;
      const timeWaiting = waitMs - timeSinceLastCall;
      const remainingWait = maxing
        ? Math.min(timeWaiting, (maxWait ?? 0) - timeSinceLastInvoke)
        : timeWaiting;

      // Restart the timer
      startTimer(timerExpired, remainingWait);
    };

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The debounce state machine is intentionally kept in one closure to preserve timer behavior and allocations.
    const debouncedCallback = function (
      this: unknown,
      ...args: Parameters<T>
    ): ReturnType<T> | undefined {
      if (!(isClientSize || debounceOnServer)) {
        return;
      }

      const time = Date.now();
      const isInvoking = shouldInvoke(time);

      lastArgs.current = args;
      lastThis.current = this;
      lastCallTime.current = time;

      if (isInvoking) {
        if (!timerId.current && mounted.current) {
          // Reset any `maxWait` timer.
          lastInvokeTime.current = lastCallTime.current;
          // Start the timer for the trailing edge.
          startTimer(timerExpired, waitMs);

          // Invoke the leading edge.
          return leading ? invokeFunc(lastCallTime.current) : result.current;
        }
        if (maxing) {
          // Handle invocations in a tight loop.
          startTimer(timerExpired, waitMs);

          return invokeFunc(lastCallTime.current);
        }
      }
      if (!timerId.current) {
        startTimer(timerExpired, waitMs);
      }
      return result.current;
    } as DebouncedState<T>;

    debouncedCallback.cancel = () => {
      if (timerId.current) {
        if (useRAF) {
          cancelAnimationFrame(timerId.current as number);
        } else {
          clearTimeout(timerId.current as number);
        }
      }

      lastInvokeTime.current = 0;
      lastArgs.current =
        lastCallTime.current =
        lastThis.current =
        timerId.current =
          null;
    };

    debouncedCallback.isPending = () => !!timerId.current;

    debouncedCallback.flush = () =>
      timerId.current ? trailingEdge(Date.now()) : result.current;

    return debouncedCallback;
  }, [
    leading,
    maxing,
    waitMs,
    maxWait,
    trailing,
    useRAF,
    isClientSize,
    debounceOnServer,
  ]);

  return debounced;
}
