interface Props {
  color: string;
  size?: number; // 9 on Home, 10 in the QR pill, 12 on the Camera card
  pulse?: boolean; // QR pill while waiting or reading
}

export function StatusDot({ color, size = 9, pulse = false }: Props) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        flex: 'none',
        animation: pulse ? 'qrpulse 1.2s ease-in-out infinite' : 'none',
      }}
    />
  );
}
