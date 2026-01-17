import Calculator from 'lucide-react/dist/esm/icons/calculator.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import CreditCard from 'lucide-react/dist/esm/icons/credit-card.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import Smile from 'lucide-react/dist/esm/icons/smile.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Bell from 'lucide-react/dist/esm/icons/bell.js';
import Menu from 'lucide-react/dist/esm/icons/menu.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import UserCircle from 'lucide-react/dist/esm/icons/circle-user.js';
import * as React from "react"

import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useAuth } from "@/lib/auth"
import { ThemeToggle } from "../theme-toggle"
import { FacilitySwitcher } from "./FacilitySwitcher"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useNavigate } from "react-router-dom"

import NotificationCenter from "./NotificationCenter"

export function OmniBar() {
    const [open, setOpen] = React.useState(false)
    const { user, logout } = useAuth()
    const navigate = useNavigate()

    React.useEffect(() => {
        const down = (e) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                setOpen((open) => !open)
            }
        }

        document.addEventListener("keydown", down)
        return () => document.removeEventListener("keydown", down)
    }, [])

    const handleLogout = async () => {
        await logout()
    }

    return (
        <header className="fixed top-0 left-0 right-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 h-16 flex items-center px-4 gap-4">
            <SidebarTrigger />

            <div className="flex-1 flex items-center max-w-2xl">
                <Button
                    variant="outline"
                    className="relative h-9 w-full justify-start rounded-[0.5rem] bg-muted/50 text-sm font-normal text-muted-foreground shadow-none sm:pr-12 md:w-full lg:w-[400px]"
                    onClick={() => setOpen(true)}
                >
                    <span className="hidden lg:inline-flex">Search patients, pages, or actions...</span>
                    <span className="inline-flex lg:hidden">Search...</span>
                    <kbd className="pointer-events-none absolute right-[0.3rem] top-[0.3rem] hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                        <span className="text-xs">⌘</span>K
                    </kbd>
                </Button>
            </div>

            <div className="ml-auto flex items-center space-x-4">
                {/* Unified notification center */}
                <NotificationCenter />

                <FacilitySwitcher />

                <ThemeToggle />

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                            <UserCircle className="h-6 w-6" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56" align="end" forceMount>
                        <DropdownMenuLabel className="font-normal">
                            <div className="flex flex-col space-y-1">
                                <p className="text-sm font-medium leading-none">{user?.name || "User"}</p>
                                <p className="text-xs leading-none text-muted-foreground">
                                    {user?.email || ""}
                                </p>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => navigate('/settings')}>
                            <Settings className="mr-2 h-4 w-4" />
                            <span>Settings</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleLogout}>
                            <LogOut className="mr-2 h-4 w-4" />
                            <span>Log out</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <CommandDialog open={open} onOpenChange={setOpen}>
                <CommandInput placeholder="Type a command or search..." />
                <CommandList>
                    <CommandEmpty>No results found.</CommandEmpty>
                    <CommandGroup heading="Suggestions">
                        <CommandItem onSelect={() => {
                            setOpen(false)
                            navigate('/dashboard')
                        }}>
                            <Calendar className="mr-2 h-4 w-4" />
                            <span>Calendar</span>
                        </CommandItem>
                        <CommandItem onSelect={() => {
                            setOpen(false)
                            navigate('/patients')
                        }}>
                            <Smile className="mr-2 h-4 w-4" />
                            <span>Search Patients</span>
                        </CommandItem>
                        <CommandItem onSelect={() => {
                            setOpen(false)
                            navigate('/billing')
                        }}>
                            <Calculator className="mr-2 h-4 w-4" />
                            <span>Billing</span>
                        </CommandItem>
                    </CommandGroup>
                    <CommandGroup heading="Settings">
                        <CommandItem onSelect={() => {
                            setOpen(false)
                            navigate('/profile')
                        }}>
                            <User className="mr-2 h-4 w-4" />
                            <span>Profile</span>
                            <CommandShortcut>⌘P</CommandShortcut>
                        </CommandItem>
                        <CommandItem onSelect={() => {
                            setOpen(false)
                            navigate('/settings')
                        }}>
                            <Settings className="mr-2 h-4 w-4" />
                            <span>Settings</span>
                            <CommandShortcut>⌘S</CommandShortcut>
                        </CommandItem>
                    </CommandGroup>
                </CommandList>
            </CommandDialog>
        </header>
    )
}
