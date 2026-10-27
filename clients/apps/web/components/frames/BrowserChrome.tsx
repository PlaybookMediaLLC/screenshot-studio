'use client'

import type { CSSProperties, ReactNode } from 'react'
import type { Insets } from '@/lib/frames/geometry'
import type { FrameChrome, Tone } from '@/lib/frames/schema'
import {
  CHROME_FONT,
  Favicon,
  Glyph,
  hostOf,
  oneLine,
  tabTitles,
  TrafficLights,
  WindowControls,
} from './chrome-parts'

/**
 * Browser chrome for Safari, Chrome, Arc, Edge, and Firefox, light or dark,
 * with tabs, an address bar, and an optional bookmarks bar. It draws the
 * chrome only, over a frame box whose content area the caller fills.
 */

type ChromeProps = {
  chrome: FrameChrome
  insets: Insets
  tone: Tone
  /** Pixels per chrome unit. */
  unit: number
}

/** The window background behind a browser's content, also used by the frame box. */
export function browserBackground(chrome: FrameChrome, tone: Tone): string {
  const dark = tone === 'dark'
  switch (chrome.browser) {
    case 'arc':
      return dark
        ? 'linear-gradient(140deg, #2d2840 0%, #1f2536 100%)'
        : 'linear-gradient(140deg, #ece6f8 0%, #dbe5f6 100%)'
    case 'safari':
      return dark ? '#2c2c2e' : '#f3f3f3'
    case 'edge':
      return dark ? '#1f1f1f' : '#f3f3f3'
    case 'firefox':
      return dark ? '#1c1b22' : '#f0f0f4'
    default:
      return dark ? '#202124' : '#dfe3e7'
  }
}

function Row({
  bookmarks,
  children,
  height,
  style,
}: {
  bookmarks?: boolean
  children: ReactNode
  height: number
  style?: CSSProperties
}) {
  return (
    <div
      data-bookmarks={bookmarks ? 'true' : undefined}
      style={{
        alignItems: 'center',
        boxSizing: 'border-box',
        display: 'flex',
        height,
        position: 'relative',
        width: '100%',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function BookmarksBar({
  chrome,
  color,
  background,
  border,
  unit,
}: {
  background: string
  border: string
  chrome: FrameChrome
  color: string
  unit: number
}) {
  const items =
    chrome.bookmarks.length > 0 ? chrome.bookmarks : ['Docs', 'Pricing', 'Changelog', 'Blog']
  return (
    <Row
      bookmarks
      height={unit * 2.3}
      style={{
        background,
        borderBottom: `1px solid ${border}`,
        gap: unit * 1.6,
        padding: `0 ${unit * 1.4}px`,
      }}
    >
      {items.map((item, index) => (
        <span
          key={index}
          style={{
            alignItems: 'center',
            color,
            display: 'flex',
            fontSize: unit * 1.05,
            gap: unit * 0.5,
            ...oneLine,
          }}
        >
          <Glyph
            color={color}
            name={index % 3 === 2 ? 'folder' : 'globe'}
            size={unit * 1.15}
            style={{ opacity: 0.75 }}
          />
          <span style={oneLine}>{item}</span>
        </span>
      ))}
    </Row>
  )
}

function Safari({ chrome, tone, unit }: ChromeProps) {
  const dark = tone === 'dark'
  const toolbar = dark ? '#2c2c2e' : '#f3f3f3'
  const icon = dark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.5)'
  const text = dark ? 'rgba(255,255,255,0.86)' : 'rgba(0,0,0,0.78)'
  const border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'
  const titles = tabTitles(chrome.tabs, chrome.address)
  const glyph = unit * 1.55
  return (
    <>
      <Row
        height={unit * 3.8}
        style={{
          background: toolbar,
          borderBottom: `1px solid ${border}`,
          gap: unit * 1.1,
          padding: `0 ${unit * 1.4}px`,
        }}
      >
        <TrafficLights size={unit * 1.2} />
        <Glyph color={icon} name="sidebar" size={glyph} style={{ marginLeft: unit * 0.8 }} />
        <Glyph color={icon} name="chevronLeft" size={glyph} />
        <Glyph color={icon} name="chevronRight" size={glyph} style={{ opacity: 0.45 }} />
        <div style={{ display: 'flex', flex: 1, justifyContent: 'center', minWidth: 0 }}>
          <div
            style={{
              alignItems: 'center',
              background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.055)',
              borderRadius: unit * 0.65,
              display: 'flex',
              gap: unit * 0.6,
              height: unit * 2.4,
              justifyContent: 'center',
              maxWidth: '100%',
              padding: `0 ${unit * 1}px`,
              position: 'relative',
              width: unit * 46,
            }}
          >
            <Glyph color={icon} name="lock" size={unit * 1.05} />
            <span style={{ color: text, fontSize: unit * 1.2, ...oneLine }}>
              {hostOf(chrome.address)}
            </span>
            <Glyph
              color={icon}
              name="reload"
              size={unit * 1.15}
              style={{ position: 'absolute', right: unit * 0.9 }}
            />
          </div>
        </div>
        <Glyph color={icon} name="share" size={glyph} />
        <Glyph color={icon} name="plus" size={glyph} />
        <Glyph color={icon} name="tabs" size={glyph} />
      </Row>
      {titles.length > 1 ? (
        <Row
          height={unit * 2.7}
          style={{ background: dark ? '#1f1f21' : '#e3e3e3', borderBottom: `1px solid ${border}` }}
        >
          {titles.map((title, index) => {
            const active = index === Math.min(chrome.activeTab, titles.length - 1)
            return (
              <div
                key={index}
                style={{
                  alignItems: 'center',
                  background: active ? toolbar : 'transparent',
                  borderLeft: index > 0 ? `1px solid ${border}` : undefined,
                  color: active ? text : icon,
                  display: 'flex',
                  flex: 1,
                  fontSize: unit * 1.05,
                  gap: unit * 0.5,
                  height: '100%',
                  justifyContent: 'center',
                  minWidth: 0,
                  padding: `0 ${unit}px`,
                }}
              >
                <Favicon size={unit * 1.2} title={title} />
                <span style={oneLine}>{title}</span>
              </div>
            )
          })}
        </Row>
      ) : null}
      {chrome.showBookmarks ? (
        <BookmarksBar
          background={toolbar}
          border={border}
          chrome={chrome}
          color={text}
          unit={unit}
        />
      ) : null}
    </>
  )
}

type TabStripStyle = {
  activeTab: string
  close: boolean
  floating: boolean
  radius: number
  strip: string
  text: string
  muted: string
}

function TabStrip({
  chrome,
  leading,
  style,
  trailing,
  unit,
}: {
  chrome: FrameChrome
  leading: ReactNode
  style: TabStripStyle
  trailing?: ReactNode
  unit: number
}) {
  const titles = tabTitles(chrome.tabs, chrome.address)
  const active = Math.min(chrome.activeTab, titles.length - 1)
  const height = unit * 3.1
  return (
    <Row
      height={height}
      style={{
        alignItems: 'flex-end',
        background: style.strip,
        padding: `0 ${unit * 1.2}px`,
        gap: unit * 0.4,
      }}
    >
      <div
        style={{
          alignItems: 'center',
          alignSelf: 'stretch',
          display: 'flex',
          gap: unit * 0.9,
          marginRight: unit * 0.6,
        }}
      >
        {leading}
      </div>
      {titles.map((title, index) => {
        const isActive = index === active
        return (
          <div
            key={index}
            style={{
              alignItems: 'center',
              alignSelf: style.floating ? 'center' : 'flex-end',
              background: isActive ? style.activeTab : 'transparent',
              borderRadius: style.floating
                ? style.radius
                : `${style.radius}px ${style.radius}px 0 0`,
              boxShadow: isActive && style.floating ? '0 1px 3px rgba(0,0,0,0.18)' : undefined,
              color: isActive ? style.text : style.muted,
              display: 'flex',
              flex: '0 1 auto',
              fontSize: unit * 1.08,
              gap: unit * 0.6,
              height: style.floating ? unit * 2.3 : unit * 2.55,
              minWidth: 0,
              padding: `0 ${unit * 0.9}px`,
              width: unit * 19,
            }}
          >
            <Favicon size={unit * 1.25} title={title} />
            <span style={{ flex: 1, ...oneLine }}>{title}</span>
            {style.close ? <Glyph color={style.muted} name="close" size={unit * 1} /> : null}
          </div>
        )
      })}
      <div
        style={{
          alignItems: 'center',
          alignSelf: 'stretch',
          display: 'flex',
          marginLeft: unit * 0.4,
        }}
      >
        <Glyph color={style.muted} name="plus" size={unit * 1.35} />
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ alignItems: 'center', alignSelf: 'stretch', display: 'flex', gap: unit * 0.8 }}>
        {trailing}
      </div>
    </Row>
  )
}

function AddressRow({
  background,
  chrome,
  field,
  fieldRadius,
  icon,
  leading,
  leadingIcon,
  text,
  trailing,
  unit,
}: {
  background: string
  chrome: FrameChrome
  field: string
  fieldRadius: number
  icon: string
  leading: ReactNode
  leadingIcon: ReactNode
  text: string
  trailing: ReactNode
  unit: number
}) {
  return (
    <Row height={unit * 3.1} style={{ background, gap: unit * 1.1, padding: `0 ${unit * 1.2}px` }}>
      {leading}
      <div
        style={{
          alignItems: 'center',
          background: field,
          borderRadius: fieldRadius,
          display: 'flex',
          flex: 1,
          gap: unit * 0.7,
          height: unit * 2.3,
          minWidth: 0,
          padding: `0 ${unit * 1}px`,
        }}
      >
        {leadingIcon}
        <span style={{ color: text, flex: 1, fontSize: unit * 1.15, ...oneLine }}>
          {chrome.address}
        </span>
        <Glyph color={icon} name="star" size={unit * 1.25} />
      </div>
      {trailing}
    </Row>
  )
}

function Chrome({ chrome, tone, unit }: ChromeProps) {
  const dark = tone === 'dark'
  const toolbar = dark ? '#35363a' : '#ffffff'
  const icon = dark ? '#c4c7c5' : '#474747'
  const text = dark ? '#e3e3e3' : '#1f1f1f'
  const glyph = unit * 1.45
  return (
    <>
      <TabStrip
        chrome={chrome}
        leading={<TrafficLights size={unit * 1.2} />}
        style={{
          activeTab: toolbar,
          close: true,
          floating: false,
          muted: dark ? '#9aa0a6' : '#5f6368',
          radius: unit * 0.8,
          strip: dark ? '#202124' : '#dfe3e7',
          text,
        }}
        trailing={<Glyph color={icon} name="chevronDown" size={unit * 1.25} />}
        unit={unit}
      />
      <AddressRow
        background={toolbar}
        chrome={chrome}
        field={dark ? '#282828' : '#e9eef6'}
        fieldRadius={unit * 1.15}
        icon={icon}
        leading={
          <>
            <Glyph color={icon} name="chevronLeft" size={glyph} />
            <Glyph color={icon} name="chevronRight" size={glyph} style={{ opacity: 0.4 }} />
            <Glyph color={icon} name="reload" size={glyph} />
          </>
        }
        leadingIcon={<Glyph color={icon} name="tune" size={unit * 1.2} />}
        text={text}
        trailing={
          <>
            <span
              style={{
                background: '#1a73e8',
                borderRadius: '50%',
                display: 'block',
                flexShrink: 0,
                height: unit * 1.6,
                width: unit * 1.6,
              }}
            />
            <Glyph color={icon} name="menu" size={glyph} />
          </>
        }
        unit={unit}
      />
      {chrome.showBookmarks ? (
        <BookmarksBar
          background={toolbar}
          border={dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}
          chrome={chrome}
          color={text}
          unit={unit}
        />
      ) : null}
    </>
  )
}

function Edge({ chrome, tone, unit }: ChromeProps) {
  const dark = tone === 'dark'
  const toolbar = dark ? '#2e2e2e' : '#ffffff'
  const icon = dark ? '#d6d6d6' : '#424242'
  const text = dark ? '#f0f0f0' : '#1a1a1a'
  const glyph = unit * 1.45
  return (
    <>
      <TabStrip
        chrome={chrome}
        leading={<Glyph color={icon} name="tabs" size={unit * 1.35} />}
        style={{
          activeTab: toolbar,
          close: true,
          floating: false,
          muted: dark ? '#b3b3b3' : '#616161',
          radius: unit * 0.7,
          strip: dark ? '#1f1f1f' : '#f3f3f3',
          text,
        }}
        trailing={<WindowControls color={icon} height={unit * 3.1} unit={unit} />}
        unit={unit}
      />
      <AddressRow
        background={toolbar}
        chrome={chrome}
        field={dark ? '#3b3b3b' : '#f1f1f1'}
        fieldRadius={unit * 1.15}
        icon={icon}
        leading={
          <>
            <Glyph color={icon} name="chevronLeft" size={glyph} />
            <Glyph color={icon} name="reload" size={glyph} />
            <Glyph color={icon} name="home" size={glyph} />
          </>
        }
        leadingIcon={<Glyph color={icon} name="lock" size={unit * 1.1} />}
        text={text}
        trailing={
          <>
            <Glyph color={icon} name="star" size={glyph} />
            <Glyph color={icon} name="user" size={glyph} />
            <span
              style={{
                background:
                  'conic-gradient(from 200deg, #2bc8f6, #2e7cf6, #a65ef2, #f25e9b, #2bc8f6)',
                borderRadius: '50%',
                display: 'block',
                flexShrink: 0,
                height: unit * 1.6,
                width: unit * 1.6,
              }}
            />
          </>
        }
        unit={unit}
      />
      {chrome.showBookmarks ? (
        <BookmarksBar
          background={toolbar}
          border={dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}
          chrome={chrome}
          color={text}
          unit={unit}
        />
      ) : null}
    </>
  )
}

function Firefox({ chrome, tone, unit }: ChromeProps) {
  const dark = tone === 'dark'
  const toolbar = dark ? '#2b2a33' : '#f9f9fb'
  const icon = dark ? '#fbfbfe' : '#15141a'
  const text = dark ? '#fbfbfe' : '#15141a'
  const glyph = unit * 1.45
  return (
    <>
      <TabStrip
        chrome={chrome}
        leading={<TrafficLights size={unit * 1.2} />}
        style={{
          activeTab: dark ? '#42414d' : '#ffffff',
          close: true,
          floating: true,
          muted: dark ? '#cfcfd8' : '#5b5b66',
          radius: unit * 0.45,
          strip: dark ? '#1c1b22' : '#f0f0f4',
          text,
        }}
        trailing={<Glyph color={icon} name="chevronDown" size={unit * 1.25} />}
        unit={unit}
      />
      <AddressRow
        background={toolbar}
        chrome={chrome}
        field={dark ? '#1c1b22' : '#f0f0f4'}
        fieldRadius={unit * 0.45}
        icon={icon}
        leading={
          <>
            <Glyph color={icon} name="chevronLeft" size={glyph} />
            <Glyph color={icon} name="chevronRight" size={glyph} style={{ opacity: 0.4 }} />
            <Glyph color={icon} name="reload" size={glyph} />
          </>
        }
        leadingIcon={
          <>
            <Glyph color={icon} name="shield" size={unit * 1.15} style={{ opacity: 0.8 }} />
            <Glyph color={icon} name="lock" size={unit * 1.1} style={{ opacity: 0.8 }} />
          </>
        }
        text={text}
        trailing={
          <>
            <Glyph color={icon} name="download" size={glyph} />
            <Glyph color={icon} name="user" size={glyph} />
            <Glyph color={icon} name="menu" size={glyph} />
          </>
        }
        unit={unit}
      />
      {chrome.showBookmarks ? (
        <BookmarksBar
          background={toolbar}
          border={dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}
          chrome={chrome}
          color={text}
          unit={unit}
        />
      ) : null}
    </>
  )
}

function Arc({ chrome, insets, tone, unit }: ChromeProps) {
  const dark = tone === 'dark'
  const text = dark ? 'rgba(255,255,255,0.88)' : 'rgba(25,20,45,0.85)'
  const muted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(25,20,45,0.48)'
  const card = dark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.6)'
  const titles = tabTitles(chrome.tabs, chrome.address)
  const active = Math.min(chrome.activeTab, titles.length - 1)
  const glyph = unit * 1.1
  const favorites = (
    chrome.bookmarks.length > 0 ? chrome.bookmarks : ['Mail', 'Calendar', 'Figma', 'Linear']
  ).slice(0, 8)
  return (
    <div
      style={{
        bottom: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: unit * 1.1,
        left: 0,
        padding: `${unit * 1.2}px ${unit * 1}px ${unit * 1.2}px ${unit * 1.2}px`,
        position: 'absolute',
        top: 0,
        width: insets.left,
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: unit * 0.6 }}>
        <TrafficLights size={unit * 1.15} />
        <div style={{ flex: 1 }} />
        <Glyph color={muted} name="sidebar" size={glyph} />
        <Glyph color={muted} name="chevronLeft" size={glyph} />
        <Glyph color={muted} name="chevronRight" size={glyph} />
        <Glyph color={muted} name="reload" size={glyph} />
      </div>
      <div
        style={{
          alignItems: 'center',
          background: card,
          borderRadius: unit * 0.8,
          color: text,
          display: 'flex',
          fontSize: unit * 1.12,
          gap: unit * 0.6,
          height: unit * 2.7,
          padding: `0 ${unit * 0.9}px`,
        }}
      >
        <Glyph color={muted} name="lock" size={unit * 1} />
        <span style={oneLine}>{hostOf(chrome.address)}</span>
      </div>
      {chrome.showBookmarks ? (
        <div
          data-bookmarks="true"
          style={{ display: 'grid', gap: unit * 0.6, gridTemplateColumns: 'repeat(4, 1fr)' }}
        >
          {favorites.map((favorite, index) => (
            <div
              key={index}
              style={{
                alignItems: 'center',
                background: card,
                borderRadius: unit * 0.7,
                display: 'flex',
                height: unit * 2.8,
                justifyContent: 'center',
              }}
            >
              <Favicon size={unit * 1.35} title={favorite} />
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ background: muted, height: 1, opacity: 0.35 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: unit * 0.25 }}>
        {titles.map((title, index) => (
          <div
            key={index}
            style={{
              alignItems: 'center',
              background: index === active ? card : 'transparent',
              borderRadius: unit * 0.7,
              boxShadow: index === active && !dark ? '0 1px 2px rgba(0,0,0,0.06)' : undefined,
              color: index === active ? text : muted,
              display: 'flex',
              fontSize: unit * 1.08,
              gap: unit * 0.7,
              height: unit * 2.5,
              padding: `0 ${unit * 0.8}px`,
            }}
          >
            <Favicon size={unit * 1.25} title={title} />
            <span style={oneLine}>{title}</span>
          </div>
        ))}
        <div
          style={{
            alignItems: 'center',
            color: muted,
            display: 'flex',
            fontSize: unit * 1.08,
            gap: unit * 0.7,
            height: unit * 2.5,
            padding: `0 ${unit * 0.8}px`,
          }}
        >
          <Glyph color={muted} name="plus" size={unit * 1.25} />
          <span style={oneLine}>New Tab</span>
        </div>
      </div>
    </div>
  )
}

/** The chrome of one browser, drawn over its frame box. */
export function BrowserChrome(props: ChromeProps) {
  const body = (() => {
    switch (props.chrome.browser) {
      case 'safari':
        return <Safari {...props} />
      case 'arc':
        return <Arc {...props} />
      case 'edge':
        return <Edge {...props} />
      case 'firefox':
        return <Firefox {...props} />
      default:
        return <Chrome {...props} />
    }
  })()
  return (
    <div
      aria-hidden="true"
      data-frame-chrome={props.chrome.browser}
      style={{
        fontFamily: CHROME_FONT,
        inset: 0,
        lineHeight: 'normal',
        pointerEvents: 'none',
        position: 'absolute',
      }}
    >
      {body}
    </div>
  )
}
