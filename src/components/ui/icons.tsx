import type { ComponentType } from 'react'
import * as TablerIcons from '@tabler/icons-react'
import type { IconProps } from '@tabler/icons-react'

type IconComponent = ComponentType<IconProps>

const tablerIconMap = TablerIcons as unknown as Record<string, unknown>
const fallbackIcon = (tablerIconMap.IconHelpCircle || tablerIconMap.IconQuestionMark) as IconComponent

function isIconComponent(value: unknown): value is IconComponent {
  if (typeof value === 'function') return true
  if (typeof value !== 'object' || value === null) return false
  return '$$typeof' in value
}

function pickIcon(name: string): IconComponent {
  const maybeIcon = tablerIconMap[name]
  return isIconComponent(maybeIcon) ? maybeIcon : fallbackIcon
}

// Keep Lucide-compatible type for existing icon metadata usage.
export type LucideIcon = IconComponent

export const PhotoScan = pickIcon('IconPhotoScan')
export const AlertTriangle = pickIcon('IconAlertTriangle')
export const ArrowRightLeft = pickIcon('IconArrowsRightLeft')
export const ArrowUpDown = pickIcon('IconArrowsUpDown')
export const BarChart3 = pickIcon('IconChartBar')
export const BookCheck = pickIcon('IconBookCheck')
export const BookOpen = pickIcon('IconBook2')
export const BookOpenCheck = pickIcon('IconBook2')
export const Brain = pickIcon('IconBrain')
export const Camera = pickIcon('IconCamera')
export const Check = pickIcon('IconCheck')
export const CheckCircle = pickIcon('IconCircleCheck')
export const CheckIcon = pickIcon('IconCheck')
export const ChevronDownIcon = pickIcon('IconChevronDown')
export const ChevronLeft = pickIcon('IconChevronLeft')
export const ChevronRight = pickIcon('IconChevronRight')
export const ChevronRightIcon = pickIcon('IconChevronRight')
export const CircleCheckIcon = pickIcon('IconCircleCheck')
export const CircleIcon = pickIcon('IconCircle')
export const Crown = pickIcon('IconCrown')
export const ExternalLink = pickIcon('IconExternalLink')
export const Eye = pickIcon('IconEye')
export const EyeOff = pickIcon('IconEyeOff')
export const FileImage = pickIcon('IconFileImage')
export const Flag = pickIcon('IconFlag')
export const Flame = pickIcon('IconFlame')
export const FolderOpen = pickIcon('IconFolderOpen')
export const Info = pickIcon('IconInfoCircle')
export const InfoIcon = pickIcon('IconInfoCircle')
export const ImagePlus = pickIcon('IconPhotoPlus')
export const Link2Off = pickIcon('IconLinkOff')
export const LinkIcon = pickIcon('IconLink')
export const Loader2 = pickIcon('IconLoader2')
export const Loader2Icon = pickIcon('IconLoader2')
export const Lock = pickIcon('IconLock')
export const LogIn = pickIcon('IconLogin2')
export const OctagonXIcon = pickIcon('IconCircleX')
export const PartyPopper = pickIcon('IconConfetti')
export const Pencil = pickIcon('IconPencil')
export const Search = pickIcon('IconSearch')
export const SearchX = pickIcon('IconSearchOff')
export const Share2 = pickIcon('IconShare2')
export const SlidersHorizontal = pickIcon('IconAdjustmentsHorizontal')
export const Sparkles = pickIcon('IconSparkles')
export const Star = pickIcon('IconStar')
export const Target = pickIcon('IconTarget')
export const Trash2 = pickIcon('IconTrash')
export const TrendingUp = pickIcon('IconTrendingUp')
export const Trophy = pickIcon('IconTrophy')
export const TriangleAlertIcon = pickIcon('IconAlertTriangle')
export const Undo2 = pickIcon('IconArrowBackUp')
export const X = pickIcon('IconX')
export const XIcon = pickIcon('IconX')
export const Zap = pickIcon('IconBolt')
