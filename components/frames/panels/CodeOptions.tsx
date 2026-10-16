'use client'

import * as React from 'react'
import { ToggleField } from '@/components/editor/inspector/fields'
import { Slider } from '@/components/ui/slider'
import { CODE_LANGUAGES, CODE_THEMES } from '@/lib/frames/code'
import { updateScreenCode } from '@/lib/frames/commands'
import {
  CODE_FONT_IDS,
  type CodeContent,
  type CodeLanguage,
  codeLanguageSchema,
  type CodeTheme,
  codeThemeSchema,
  MAX_CODE_LENGTH,
} from '@/lib/frames/schema'
import { googleFontFamily } from '@/lib/typography/google-fonts'

const selectClass =
  'h-8 w-full rounded-md border border-foreground/10 bg-foreground/[0.04] px-2 text-xs text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15'

function SelectField<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: Value) => void
  options: readonly { label: string; value: Value }[]
  value: Value
}) {
  const id = React.useId()
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <select
        className={selectClass}
        id={id}
        onChange={(event) => onChange(event.target.value as Value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** A code screen's code, language, theme, font, line numbers, and padding. */
export function CodeOptions({ code, id }: { code: CodeContent; id: string }) {
  const update = (changes: Partial<CodeContent>) => updateScreenCode(id, changes)
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground" htmlFor={`${id}-code`}>
          Code
        </label>
        <textarea
          className="min-h-40 w-full resize-y rounded-md border border-foreground/10 bg-foreground/[0.04] p-2 font-mono text-[11px] leading-relaxed text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
          id={`${id}-code`}
          maxLength={MAX_CODE_LENGTH}
          onChange={(event) => update({ code: event.target.value })}
          placeholder="Paste code here"
          spellCheck={false}
          value={code.code}
        />
      </div>
      <SelectField<CodeLanguage>
        label="Language"
        onChange={(language) => update({ language })}
        options={codeLanguageSchema.options.map((value) => ({
          label: CODE_LANGUAGES[value],
          value,
        }))}
        value={code.language}
      />
      <SelectField<CodeTheme>
        label="Theme"
        onChange={(theme) => update({ theme })}
        options={codeThemeSchema.options.map((value) => ({
          label: CODE_THEMES[value].label,
          value,
        }))}
        value={code.theme}
      />
      <SelectField<string>
        label="Font"
        onChange={(font) => update({ font })}
        options={CODE_FONT_IDS.map((value) => ({ label: googleFontFamily(value), value }))}
        value={code.font}
      />
      <ToggleField
        checked={code.lineNumbers}
        label="Line numbers"
        onChange={(lineNumbers) => update({ lineNumbers })}
      />
      <Slider
        label="Padding"
        max={4}
        min={0}
        onValueChange={([padding]) => update({ padding })}
        step={0.25}
        value={[code.padding]}
        valueDisplay={`${code.padding} em`}
      />
    </div>
  )
}
