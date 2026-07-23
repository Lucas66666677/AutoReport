import type { HTMLAttributes, ImgHTMLAttributes } from 'react'

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
  alt = 'AutoLabReport',
  className = '',
  loading = 'eager',
}: BrandMarkProps) {
  const config = SIZE_CONFIG[size]

  return (
    <picture className="inline-flex shrink-0">
      <source
        type="image/webp"
        srcSet="/brand/autolabreport-mark-64.webp 64w, /brand/autolabreport-mark-128.webp 128w, /brand/autolabreport-mark-256.webp 256w"
        sizes={`${config.pixels}px`}
      />
      <img
        src="/brand/autolabreport-mark-256.png"
        width={config.pixels}
        height={config.pixels}
        loading={loading}
        decoding="async"
        alt={decorative ? '' : alt}
        aria-hidden={decorative || undefined}
        className={`${config.markClassName} block bg-[#05070B] object-cover ${className}`}
      />
    </picture>
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
  const autoLabColor = surface === 'dark' ? 'text-white' : 'text-slate-950'
  const reportColor = surface === 'dark' ? 'text-white/72' : 'text-slate-500'

  return (
    <div className={`inline-flex min-w-0 items-center gap-3 ${className}`} {...props}>
      <BrandMark size={size} decorative className={markClassName} />
      <span
        className={`${config.textClassName} min-w-0 truncate font-semibold tracking-tight ${
          hideTextOnMobile ? 'max-[520px]:hidden' : ''
        }`}
      >
        <span className={autoLabColor}>AutoLab</span>
        <span className={`${reportColor} font-medium`}>Report</span>
      </span>
    </div>
  )
}
