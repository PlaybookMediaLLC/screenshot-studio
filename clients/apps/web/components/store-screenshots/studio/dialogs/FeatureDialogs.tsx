'use client'

import * as React from 'react'
import type { StoreDocument } from '@/lib/store-screenshots/document/schema'
import type { StudioDialog } from '../actions'
import { CopyDialog, TranslateDialog } from './AiDialogs'
import { AnimationDialog } from './AnimationDialog'
import { BrandKitsDialog, SaveTemplateDialog, TemplatesDialog } from './LibraryDialogs'
import { PublishDialog } from './PublishDialog'
import { ReviewDialog } from './ReviewDialog'

/** Routes the feature dialogs (templates, brand kits, AI, animation, publishing, review). */
export function StudioFeatureDialogs({
  dialog,
  onOpenChange,
  onCreateProject,
}: {
  dialog: StudioDialog | null
  onOpenChange: (open: boolean) => void
  onCreateProject: (document: StoreDocument) => void
}): React.JSX.Element | null {
  switch (dialog) {
    case 'templates':
      return <TemplatesDialog open onOpenChange={onOpenChange} onCreateProject={onCreateProject} />
    case 'saveTemplate':
      return <SaveTemplateDialog open onOpenChange={onOpenChange} />
    case 'brandKits':
      return <BrandKitsDialog open onOpenChange={onOpenChange} />
    case 'animation':
      return <AnimationDialog open onOpenChange={onOpenChange} />
    case 'translate':
      return <TranslateDialog open onOpenChange={onOpenChange} />
    case 'copy':
      return <CopyDialog open onOpenChange={onOpenChange} />
    case 'review':
      return <ReviewDialog open onOpenChange={onOpenChange} />
    case 'publish':
      return <PublishDialog open onOpenChange={onOpenChange} />
    default:
      return null
  }
}
