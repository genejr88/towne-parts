import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  HelpCircle, ChevronDown, LayoutDashboard, PackageCheck, Layers,
  RotateCcw, Package, Settings, Clock, Send, Camera, CheckCheck,
  Star, Shield, FileText, AlertTriangle, Wrench, TrendingUp, Search,
  Plus, Archive, Bell
} from 'lucide-react'

const SECTIONS = [
  {
    id: 'dashboard',
    icon: LayoutDashboard,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20',
    title: 'Dashboard',
    content: [
      {
        heading: 'Overview',
        body: 'The Dashboard is your home screen. It shows four live stat cards that give you an at-a-glance pulse of the shop.'
      },
      {
        heading: 'Stat Cards',
        body: '• Ready for Paint — parts checked in within the last 7 days that still need a paint finish. Tap to view the full activity log.\n• Active ROs — all repair orders currently open (not archived).\n• All Here — ROs where every part has been received.\n• Open SRC — open supplement/return/core entries that need attention.'
      },
      {
        heading: 'Recent Parts Activity',
        body: 'Tap the "Recent Parts Activity" link card to jump to the /recent page. This shows a timestamped feed of every part that was checked in, grouped by day.'
      }
    ]
  },
  {
    id: 'ros',
    icon: PackageCheck,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    title: 'Repair Orders (Parts)',
    content: [
      {
        heading: 'Creating a New RO',
        body: 'Tap the + button on the RO list page. Fill in: RO number, vehicle details (year/make/model/color/VIN), customer name/phone, insurance company/claim number, and select a vendor. The default vendor is pre-selected automatically.'
      },
      {
        heading: 'Parts Status',
        body: 'Each RO has a parts status badge:\n• Parts Missing (red) — not all parts are received yet\n• Acknowledged (amber) — someone has noted the missing parts\n• All Here (green) — every part on the RO has been checked in\n\nThe status is calculated live from the parts array, so it\'s always accurate.'
      },
      {
        heading: 'Adding Parts',
        body: 'Open an RO → tap "Add Part." Enter the part number, description, quantity, price, ETA date, and finish status (Needs Paint / Painted / Textured / No Finish Needed). Save the part and it appears in the list.'
      },
      {
        heading: 'Checking In a Part',
        body: 'Tap the checkbox on any part row to mark it received. Or tap the Camera icon to take a photo — this automatically marks the part as received and attaches the photo. Received parts show a green card with a "HERE" badge so they\'re impossible to miss.'
      },
      {
        heading: 'Telegram Notifications',
        body: 'Each part row has a Send icon. Tap it to notify Billy on Telegram that a specific part has arrived. Confirm the prompt → message sent. You can also send an "All Parts Here" (APH) notification from the RO detail header when all parts are in.'
      },
      {
        heading: 'Photos',
        body: 'Tap the Camera icon on any part row to take a condition photo. The photo is attached to that part and opens the rear camera on mobile. Multiple photos can be added per part.'
      },
      {
        heading: 'Part Notes',
        body: 'Tap the note area under a part to add or edit a free-text note. Useful for tracking back-order status, substitution info, or vendor messages.'
      },
      {
        heading: 'Invoices & Files',
        body: 'Scroll to the Invoices section on any RO detail. Upload PDF invoices, estimates, or supplement documents. Files are stored and viewable any time.'
      },
      {
        heading: 'SRC Entries from RO Detail',
        body: 'Any return, core return, or supplement can be logged directly from an RO. These appear in the SRC Tracker automatically.'
      },
      {
        heading: 'Archiving an RO',
        body: 'When a job is delivered, tap "Archive" on the RO detail. The RO disappears from the active list and Production Board but remains searchable in the archive.'
      }
    ]
  },
  {
    id: 'board',
    icon: Layers,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/20',
    title: 'Production Board',
    content: [
      {
        heading: 'Overview',
        body: 'The Production Board is a swipeable card view of all active ROs, sorted by RO number. It\'s designed for the shop floor — tap or swipe to move between jobs.'
      },
      {
        heading: 'Navigating ROs',
        body: 'Swipe left/right to move between ROs. Use the Prev/Next buttons at the bottom. On desktop, use the left/right arrow keys. Tap "Jump to RO" to search by RO number, make, or model.'
      },
      {
        heading: 'RO Card',
        body: 'The card shows: RO number + parts status (same line), vehicle info, customer/insurance in a 2-column grid, insurance company name, and parts progress bar at the bottom.'
      },
      {
        heading: 'Stage Dropdown',
        body: 'Tap the stage chip (e.g., "Body") to open the stage picker. Select a stage: Unassigned → Teardown → Check-In → Needs Written → Approval → HBM → Body → Paint Prep → Paint → Reassembly → Final Supplement → Detail → Delivery → Completed. Selection auto-saves.'
      },
      {
        heading: 'Assign Tech',
        body: 'Tap the "Assign Tech" chip to open the technician picker. Select a tech name → the chip updates. Tap again to change or clear.'
      },
      {
        heading: 'Status Note',
        body: 'Type a free-form note in the Status Note field. It auto-saves after 1.2 seconds. Use it for internal comms: "Waiting on supplement approval", "Customer picking up Friday", etc.'
      },
      {
        heading: 'Final Supplement Toggle',
        body: 'Toggle on if this RO has a final supplement pending. When enabled, bubble tags appear for quick notes: PPD, Alignment, Scans, Calibrations, New Part, or type a custom tag.'
      },
      {
        heading: 'Total Loss',
        body: 'Toggle Total Loss on to flag the vehicle. This changes the card color to purple and hides the production stage controls. Mark YES/NO for "Released to Insurance." If linked to Totals, the invoice amount and paid/unpaid status display on the card.'
      },
      {
        heading: 'Parts Progress',
        body: 'The full-width footer of the card shows parts received vs. total with a percentage and animated progress bar. Tap it to open the Parts sheet, which shows a full list of received and pending parts.'
      },
      {
        heading: 'Mark as Delivered',
        body: 'When the vehicle leaves, tap "Mark as Delivered" at the bottom. Confirm the prompt → the RO is archived and removed from the board.'
      },
      {
        heading: 'Parts Activity',
        body: 'Tap the "Parts" button in the top bar to open the parts check-in activity feed for the last 2 days.'
      },
      {
        heading: 'Daily Log',
        body: 'Tap "Log" in the top bar to see all production board updates made today — stage changes, status notes, tech assignments.'
      }
    ]
  },
  {
    id: 'src',
    icon: RotateCcw,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/20',
    title: 'S.R.C. Tracker',
    content: [
      {
        heading: 'What is SRC?',
        body: 'SRC stands for Supplement / Return / Core. The tracker manages parts that need to go back to a vendor — either returns, core charges, or supplement-related returns.'
      },
      {
        heading: 'Creating an Entry',
        body: 'Tap the + button. Fill in: entry type (Return or Core Return), linked RO (optional), part number, part description, vendor name, return date, and any notes. Tap Save.'
      },
      {
        heading: 'Entry Statuses',
        body: '• Open — return is pending, part hasn\'t gone back yet\n• Returned — part was sent back to the vendor\n• Credited — vendor credit has been confirmed\n\nTap the status badge on any entry to cycle it forward.'
      },
      {
        heading: 'Photos',
        body: 'Each SRC entry can have photos attached (part condition, shipping label, receipt). Tap the camera icon on an entry to upload.'
      },
      {
        heading: 'Public Returns Link',
        body: 'There is a public-facing returns page at /src/public. Share this URL with vendors to let them view open return requests without logging in.'
      },
      {
        heading: 'Filtering',
        body: 'The SRC list can be filtered by status (Open / Returned / Credited) and entry type. The Open SRC count is surfaced on the Dashboard for quick visibility.'
      }
    ]
  },
  {
    id: 'inventory',
    icon: Package,
    color: 'text-teal-400',
    bg: 'bg-teal-500/10 border-teal-500/20',
    title: 'Inventory',
    content: [
      {
        heading: 'What is Inventory?',
        body: 'The Inventory module is a surplus parts catalog. Track leftover, salvage, or shop-stock parts that aren\'t assigned to a specific RO.'
      },
      {
        heading: 'Adding a Part',
        body: 'Tap + to create a new inventory item. Enter: description (required), part number, quantity, and notes. Save it to the catalog.'
      },
      {
        heading: 'Photos',
        body: 'Each inventory item can have photos. Tap the camera icon to upload. Useful for documenting condition of surplus parts.'
      },
      {
        heading: 'Search',
        body: 'The search bar filters inventory by description or part number in real time. Great for quickly checking if a part is already in stock before ordering.'
      },
      {
        heading: 'In-Stock Matching',
        body: 'When adding parts to an RO, TowneParts automatically checks if a matching part exists in Inventory. If it does, an "IN STOCK" badge appears on the part row so the parts team knows before ordering.'
      },
      {
        heading: 'Editing & Removing',
        body: 'Tap any inventory item to edit the description, part number, qty, or notes. Tap the trash icon to permanently remove it from the catalog.'
      }
    ]
  },
  {
    id: 'recent',
    icon: Clock,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    title: 'Recent Parts Activity',
    content: [
      {
        heading: 'Overview',
        body: 'The /recent page shows a timestamped feed of every part check-in across all ROs, grouped by calendar date. It auto-refreshes every 20 seconds.'
      },
      {
        heading: 'Time Range Tabs',
        body: 'Switch between: Today / 2 Days / Week / Month. The feed updates to show activity for the selected range.'
      },
      {
        heading: 'Navigating to an RO',
        body: 'Tap any entry in the feed to jump directly to that RO\'s detail page.'
      },
      {
        heading: 'Bulk Receive Badge',
        body: 'When all parts on an RO were received at once (bulk receive), those entries display a "Bulk" badge in the feed.'
      }
    ]
  },
  {
    id: 'admin',
    icon: Settings,
    color: 'text-gray-400',
    bg: 'bg-gray-500/10 border-gray-500/20',
    title: 'Admin',
    content: [
      {
        heading: 'Access',
        body: 'The Admin panel is only visible to users with the Admin role. Staff accounts do not see it in the nav.'
      },
      {
        heading: 'Vendors',
        body: 'Add vendors with name, phone, and email. Mark one vendor as Default (★ star icon) — this vendor is auto-selected when creating a new RO. Toggle vendors active/inactive with the switch. Delete removes the vendor (blocked if it\'s in use on an existing RO).'
      },
      {
        heading: 'Users',
        body: 'Create user accounts with a full name, username, password, and role (Staff or Admin). Admin users can access the Admin panel and vendor/user management. Remove users with the trash icon — this is permanent.'
      }
    ]
  },
]

function Section({ section }) {
  const [open, setOpen] = useState(false)
  const Icon = section.icon

  return (
    <div className={`border rounded-2xl overflow-hidden transition-colors ${open ? section.bg : 'border-gray-700/50 bg-gray-800/40'}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-4 text-left"
      >
        <div className={`p-2 rounded-xl bg-gray-800/80 border border-gray-700/40`}>
          <Icon size={16} className={section.color} />
        </div>
        <span className="flex-1 text-sm font-bold text-gray-100">{section.title}</span>
        <ChevronDown
          size={16}
          className={`text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-gray-700/40 pt-4">
              {section.content.map((item, i) => (
                <div key={i}>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{item.heading}</p>
                  <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{item.body}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Help() {
  return (
    <div className="overflow-y-auto pb-28 px-4 py-5">
      <div className="max-w-lg mx-auto">

        {/* Hero */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shadow-lg">
            <HelpCircle size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-100">Help & Guide</h1>
            <p className="text-xs text-gray-500">TowneParts — parts.towneapps.com</p>
          </div>
        </div>

        <p className="text-sm text-gray-400 mb-6 leading-relaxed">
          TowneParts tracks all parts ordered for active repair orders. Tap any section below to expand its guide.
        </p>

        {/* Quick tips */}
        <div className="bg-blue-950/40 border border-blue-700/30 rounded-2xl px-4 py-3.5 mb-6">
          <p className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">Quick Tips</p>
          <ul className="space-y-1.5">
            {[
              'Tap the logo to go home. Tap it 5× fast to access the secure vault.',
              'Parts board auto-refreshes every 15 seconds.',
              'Green card = part is HERE. No more guessing.',
              'Stage + Tech chips are both in the card header — no more scrolling.',
              'Send Telegram for individual parts with the send icon on each part row.',
            ].map((tip, i) => (
              <li key={i} className="text-xs text-blue-200/80 flex items-start gap-2">
                <span className="text-blue-500 mt-0.5 shrink-0">•</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>

        {/* Accordion sections */}
        <div className="space-y-2">
          {SECTIONS.map((section) => (
            <Section key={section.id} section={section} />
          ))}
        </div>

        <p className="text-center text-xs text-gray-700 mt-8">
          TowneParts · Towne Body Shop · parts.towneapps.com
        </p>
      </div>
    </div>
  )
}
