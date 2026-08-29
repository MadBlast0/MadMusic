import { useSettings } from '@/components/common/settings-context';
import { densityAttribute, type DensityView } from '@/lib/density';

/**
 * The `data-density` a view should put on its own container.
 *
 * Returns `undefined` where the view agrees with the document, which is the
 * common case — spreading it onto an element then adds no attribute at all.
 *
 * ```tsx
 * <div {...useDensity('library')}>
 * ```
 */
export function useDensity(view: DensityView): {
  'data-density'?: 'comfortable' | 'compact';
} {
  const { settings } = useSettings();
  const value = densityAttribute(
    view,
    settings.density,
    settings.densityOverrides,
  );
  return value ? { 'data-density': value } : {};
}
