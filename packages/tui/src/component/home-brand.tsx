import { useTheme } from "../context/theme"

export function HomeBrand() {
  const { theme } = useTheme()
  return <ascii_font text="VoxCode" font="shade" color={theme.text} selectable={false} />
}
