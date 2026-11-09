import type { ReactNode } from 'react';
import { View } from 'react-native';

/** Superficie que agrupa contenido relacionado. */
export function Card({ children }: { children: ReactNode }) {
  return (
    <View className="gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {children}
    </View>
  );
}
