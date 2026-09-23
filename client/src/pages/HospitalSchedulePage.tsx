import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Plus,
  Search,
  Stethoscope,
  Users,
  X,
} from 'lucide-react'

type Shift = {
  id: number
  name: string
  role: string
  department: string
  time: string
  color: string
  initials: string
}

const week = [
  { day: 'Mon', date: 14 },
  { day: 'Tue', date: 15 },
  { day: 'Wed', date: 16 },
  { day: 'Thu', date: 17 },
  { day: 'Fri', date: 18 },
  { day: 'Sat', date: 19 },
  { day: 'Sun', date: 20 },
]

const initialShifts: Shift[] = [
  { id: 1, name: 'Dr. Maya Chen', role: 'Cardiology', department: 'Cardiology', time: '08:00 - 16:00', color: 'coral', initials: 'MC' },
  { id: 2, name: 'Nurse Jordan Lee', role: 'Registered Nurse', department: 'ICU', time: '07:00 - 15:00', color: 'mint', initials: 'JL' },
  { id: 3, name: 'Dr. Amara Okafor', role: 'Emergency Medicine', department: 'Emergency', time: '16:00 - 00:00', color: 'lavender', initials: 'AO' },
  { id: 4, name: 'Nurse Elliot Ross', role: 'Registered Nurse', department: 'Pediatrics', time: '09:00 - 17:00', color: 'yellow', initials: 'ER' },
  { id: 5, name: 'Dr. Lucas Martin', role: 'Orthopedics', department: 'Orthopedics', time: '08:00 - 16:00', color: 'blue', initials: 'LM' },
]

const colorClasses: Record<string, string> = {
  coral: 'bg-[#ffe2d9] text-[#a64d39]',
  mint: 'bg-[#d9f3e8] text-[#287b5b]',
  lavender: 'bg-[#e9e1ff] text-[#6d56a6]',
  yellow: 'bg-[#fff1c8] text-[#94701a]',
  blue: 'bg-[#dcecff] text-[#3d6b9d]',
}

function HospitalSchedulePage() {
  const [selectedDay, setSelectedDay] = useState(16)
  const [shifts, setShifts] = useState(initialShifts)
  const [search, setSearch] = useState('')
  const [showAddShift, setShowAddShift] = useState(false)
  const [department, setDepartment] = useState('All departments')

  const filteredShifts = useMemo(() => shifts.filter((shift) => {
    const matchesSearch = `${shift.name} ${shift.role}`.toLowerCase().includes(search.toLowerCase())
    return matchesSearch && (department === 'All departments' || shift.department === department)
  }), [department, search, shifts])

  function addShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || 'New team member')
    setShifts((current) => [...current, {
      id: Date.now(), name, role: 'Registered Nurse', department: String(form.get('department') || 'ICU'),
      time: String(form.get('time') || '08:00 - 16:00'), color: 'mint', initials: name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    }])
    setShowAddShift(false)
  }

  return (
    <div className="min-h-[calc(100vh-60px)] bg-[#f7f8f6] px-4 py-6 text-[#1d2c2a] sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#74827e]">
              <span className="flex size-7 items-center justify-center rounded-lg bg-[#d9f3e8] text-[#287b5b]"><Stethoscope size={16} /></span>
              Northstar Medical Center
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5"><h1 className="font-heading text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Good morning, Olivia</h1><Link to="/operations" className="w-fit rounded-lg border border-[#cfe3d7] bg-white px-3 py-2 text-xs font-semibold text-[#287b5b] hover:bg-[#f0f8f3]">Automation &amp; billing</Link></div>
            <p className="mt-2 text-sm text-[#74827e]">Here is today&apos;s staffing overview for your care team.</p>
          </div>
          <button type="button" aria-label="Notifications" className="relative mt-1 rounded-xl border border-[#e0e6e2] bg-white p-3 text-[#53645f] shadow-sm transition hover:border-[#b5cfc3] hover:text-[#287b5b]">
            <Bell size={19} />
            <span className="absolute right-2 top-2 size-1.5 rounded-full bg-[#e27a5b]" />
          </button>
        </header>

        <section className="mb-6 grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Scheduled today', value: '24', detail: '4 more than yesterday', icon: CalendarDays, tone: 'bg-[#d9f3e8] text-[#287b5b]' },
            { label: 'Coverage status', value: '92%', detail: 'All departments covered', icon: Users, tone: 'bg-[#ffe2d9] text-[#a64d39]' },
            { label: 'Open shifts', value: '03', detail: 'Needs attention today', icon: Clock3, tone: 'bg-[#fff1c8] text-[#94701a]' },
          ].map((stat) => (
            <div key={stat.label} className="flex items-center justify-between rounded-2xl border border-[#e4e9e5] bg-white p-5 shadow-[0_4px_20px_rgba(53,76,67,0.04)]">
              <div><p className="text-xs font-medium text-[#74827e]">{stat.label}</p><p className="mt-1 text-2xl font-semibold tracking-[-0.04em]">{stat.value}</p><p className="mt-1 text-xs text-[#8b9793]">{stat.detail}</p></div>
              <span className={`flex size-11 items-center justify-center rounded-xl ${stat.tone}`}><stat.icon size={20} /></span>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-[#e4e9e5] bg-white shadow-[0_4px_20px_rgba(53,76,67,0.04)]">
          <div className="flex flex-col gap-5 border-b border-[#edf0ee] p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div><div className="flex items-center gap-3"><h2 className="text-lg font-semibold tracking-[-0.02em]">Staff schedule</h2><span className="rounded-full bg-[#f0f4f1] px-2.5 py-1 text-xs font-medium text-[#74827e]">October 2024</span></div><p className="mt-1 text-sm text-[#8b9793]">Week of October 14-20</p></div>
            <div className="flex items-center gap-2"><button type="button" aria-label="Previous week" className="rounded-lg border border-[#e0e6e2] p-2 text-[#74827e] hover:bg-[#f7f8f6]"><ChevronLeft size={17} /></button><button type="button" className="rounded-lg border border-[#e0e6e2] px-3 py-2 text-xs font-semibold text-[#53645f] hover:bg-[#f7f8f6]">Today</button><button type="button" aria-label="Next week" className="rounded-lg border border-[#e0e6e2] p-2 text-[#74827e] hover:bg-[#f7f8f6]"><ChevronRight size={17} /></button><button type="button" onClick={() => setShowAddShift(true)} className="ml-2 flex items-center gap-2 rounded-lg bg-[#287b5b] px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#20694d]"><Plus size={16} /> Add shift</button></div>
          </div>

          <div className="grid grid-cols-7 gap-1 border-b border-[#edf0ee] px-4 py-4 sm:gap-2 sm:px-6">
            {week.map((item) => <button key={item.date} type="button" onClick={() => setSelectedDay(item.date)} className={`rounded-xl px-1 py-2 text-center transition ${selectedDay === item.date ? 'bg-[#287b5b] text-white shadow-sm' : 'text-[#74827e] hover:bg-[#f0f4f1]'}`}><span className="block text-[10px] font-semibold uppercase tracking-wider opacity-80 sm:text-xs">{item.day}</span><span className="mt-1 block text-base font-semibold">{item.date}</span></button>)}
          </div>

          <div className="flex flex-col gap-3 border-b border-[#edf0ee] p-4 sm:flex-row sm:p-6">
            <label className="relative flex-1"><Search className="absolute left-3 top-2.5 text-[#9aa59f]" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search team members" className="h-10 w-full rounded-lg border border-[#e0e6e2] bg-[#fbfcfb] pl-10 pr-3 text-sm outline-none placeholder:text-[#a7b0ac] focus:border-[#7eaf98] focus:ring-2 focus:ring-[#d9f3e8]" /></label><label className="relative"><Filter className="pointer-events-none absolute left-3 top-3 text-[#9aa59f]" size={15} /><select value={department} onChange={(event) => setDepartment(event.target.value)} className="h-10 w-full appearance-none rounded-lg border border-[#e0e6e2] bg-[#fbfcfb] pl-9 pr-8 text-sm text-[#53645f] outline-none focus:border-[#7eaf98] sm:w-48"><option>All departments</option><option>Cardiology</option><option>ICU</option><option>Emergency</option><option>Pediatrics</option><option>Orthopedics</option></select></label>
          </div>

          <div className="divide-y divide-[#edf0ee]">
            {filteredShifts.map((shift) => <div key={shift.id} className="flex flex-col gap-4 p-5 transition hover:bg-[#fbfcfb] sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex items-center gap-3"><span className={`flex size-10 items-center justify-center rounded-full text-xs font-bold ${colorClasses[shift.color]}`}>{shift.initials}</span><div><p className="text-sm font-semibold">{shift.name}</p><p className="mt-0.5 text-xs text-[#8b9793]">{shift.role} <span className="mx-1 text-[#c5ceca]">•</span> {shift.department}</p></div></div><div className="flex items-center justify-between gap-6 sm:justify-end"><div className="flex items-center gap-2 text-sm font-medium text-[#53645f]"><Clock3 size={15} className="text-[#9aa59f]" />{shift.time}</div><span className="rounded-full bg-[#e7f5ed] px-2.5 py-1 text-[11px] font-semibold text-[#287b5b]">Confirmed</span></div></div>)}
            {filteredShifts.length === 0 && <div className="p-10 text-center text-sm text-[#8b9793]">No shifts match your filters.</div>}
          </div>
          <div className="flex items-center justify-between border-t border-[#edf0ee] bg-[#fbfcfb] px-5 py-4 text-xs text-[#8b9793] sm:px-6"><span>Showing {filteredShifts.length} of {shifts.length} shifts</span><button type="button" className="font-semibold text-[#287b5b] hover:underline">View full schedule <ChevronRight className="ml-1 inline" size={14} /></button></div>
        </section>
      </div>

      {showAddShift && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1d2c2a]/25 p-4 backdrop-blur-sm"><form onSubmit={addShift} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><div className="mb-6 flex items-start justify-between"><div><h2 className="text-lg font-semibold">Add a shift</h2><p className="mt-1 text-sm text-[#8b9793]">Create a new assignment for Wednesday, October 16.</p></div><button type="button" aria-label="Close dialog" onClick={() => setShowAddShift(false)} className="rounded-lg p-1.5 text-[#8b9793] hover:bg-[#f0f4f1]"><X size={18} /></button></div><div className="space-y-4"><label className="block text-sm font-medium">Team member<input name="name" required placeholder="e.g. Sam Rivera" className="mt-2 h-10 w-full rounded-lg border border-[#e0e6e2] px-3 font-normal outline-none focus:border-[#7eaf98]" /></label><label className="block text-sm font-medium">Department<select name="department" className="mt-2 h-10 w-full rounded-lg border border-[#e0e6e2] bg-white px-3 font-normal outline-none focus:border-[#7eaf98]"><option>ICU</option><option>Cardiology</option><option>Emergency</option><option>Pediatrics</option></select></label><label className="block text-sm font-medium">Shift time<input name="time" defaultValue="08:00 - 16:00" className="mt-2 h-10 w-full rounded-lg border border-[#e0e6e2] px-3 font-normal outline-none focus:border-[#7eaf98]" /></label></div><button type="submit" className="mt-6 w-full rounded-lg bg-[#287b5b] py-2.5 text-sm font-semibold text-white hover:bg-[#20694d]">Add shift</button></form></div>}
    </div>
  )
}

export default HospitalSchedulePage