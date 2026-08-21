import type { HTMLAttributes, ImgHTMLAttributes } from 'react'
import { LUCIREL_WAVE_GATE_ICON } from './lucirelBrandAsset'

export type BrandSize = 'compact' | 'default' | 'large'
export type BrandSurface = 'light' | 'dark'

const SIZE_CONFIG = {
  compact: {
    pixels: 36,
    markClassName: 'h-9 w-9 rounded-[10px]',
    textClassName: 'text-sm',
  },
  default: {
    pixels: 48,
    markClassName: 'h-12 w-12 rounded-xl',
    textClassName: 'text-base',
  },
  large: {
    pixels: 96,
    markClassName: 'h-24 w-24 rounded-2xl',
    textClassName: 'text-2xl',
  },
} as const

type BrandMarkProps = {
  size?: BrandSize
  decorative?: boolean
  alt?: string
  className?: string
  loading?: ImgHTMLAttributes<HTMLImageElement>['loading']
}

export function BrandMark({
  size = 'default',
  decorative = false,
  alt = 'Lucirel Wave Gate',
  className = '',
  loading = 'eager',
}: BrandMarkProps) {
  const config = SIZE_CONFIG[size]

  return (
    <img
      src={LUCIREL_WAVE_GATE_ICON}
      width={config.pixels}
      height={config.pixels}
      loading={loading}
      decoding="async"
      alt={decorative ? '' : alt}
      aria-hidden={decorative || undefined}
      className={`${config.markClassName} block object-cover ${className}`}
    />
  )
}

type BrandLockupProps = HTMLAttributes<HTMLDivElement> & {
  size?: BrandSize
  surface?: BrandSurface
  hideTextOnMobile?: boolean
  markClassName?: string
}

export function BrandLockup({
  size = 'default',
  surface = 'light',
  hideTextOnMobile = false,
  markClassName = '',
  className = '',
  ...props
}: BrandLockupProps) {
  const config = SIZE_CONFIG[size]
  const productColor = surface === 'dark' ? 'text-[#f6f6f2]' : 'text-[#17181d]'
  const endorsementColor = surface === 'dark' ? 'text-[#c5c8cf]' : 'text-[#4f525b]'

  return (
    <div className={`inline-flex min-w-0 items-center gap-3 ${className}`} {...props}>
      <BrandMark size={size} decorative className={markClassName} />
      <span
        className={`${config.textClassName} min-w-0 truncate font-semibold tracking-tight ${
          hideTextOnMobile ? 'max-[520px]:hidden' : ''
        }`}
      >
        <span className={productColor}>AutoLabReport</span>
        <span className={`${endorsementColor} ml-1.5 text-[0.72em] font-medium`}>by Lucirel</span>
      </span>
    </div>
  )
}
