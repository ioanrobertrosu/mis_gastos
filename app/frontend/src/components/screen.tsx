import { styled } from 'nativewind';
import type { ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

// Componente de terceros: NativeWind solo traduce `className` en los de React Native.
const StyledSafeAreaView = styled(SafeAreaView);

/** Contenedor de cada pantalla: respeta notch, isla dinámica y barras del sistema. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <StyledSafeAreaView className="flex-1 bg-white px-4 dark:bg-zinc-950">
      {children}
    </StyledSafeAreaView>
  );
}
