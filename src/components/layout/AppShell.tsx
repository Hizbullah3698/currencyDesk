import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-stretch">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="max-w-[1360px] px-[22px] pb-[72px] pt-7">{children}</div>
      </div>
    </div>
  )
}
