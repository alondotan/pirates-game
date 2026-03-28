import { GRAVITY } from './constants';

export const calculateRangeParams = (power) => {
  const vH = 0.7 + power * 0.35;
  const vV = power * 0.25;
  const timeToHit = (2 * vV) / GRAVITY;
  return { vH, vV, timeToHit, dist: vH * timeToHit };
};
