import { produce } from 'immer'
import type { IStore } from './useStore'

/** Open/closed state for `<SettingsSection>` accordions.
 *
 *  State shape: a map from `group` → currently-open `id` (or null
 *  when all sections in the group are closed). This gives us
 *  exclusive-accordion behavior per group — opening one section in a
 *  group closes any other section in the same group automatically.
 *
 *  Most callers don't pass a `group`; they share the default group.
 *  Pass an explicit group to scope exclusivity (e.g. one settings
 *  panel uses `group="body"`, another uses `group="audio"`, and they
 *  don't fight each other).
 *
 *  Not persisted — accordion state is ephemeral UI presentation. */

const storeAccordions = (set: any) => ({
  accordions: {} as Record<string, string | null>,

  setOpenAccordion: (group: string, id: string | null): void =>
    set(
      produce((s: IStore) => {
        s.accordions[group] = id
      }),
      false,
      'accordions/setOpen',
    ),
})

export default storeAccordions
