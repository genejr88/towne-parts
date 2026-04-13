import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Store, Users, Plus, Trash2, UserX, ToggleLeft, ToggleRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { vendorsApi, usersApi } from '@/lib/api'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'

// ── Vendors ────────────────────────────────────────────────────────────────────
function AddVendorModal({ open, onClose }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ name: '', phone: '', email: '' })

  const mutation = useMutation({
    mutationFn: vendorsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success('Vendor added')
      setForm({ name: '', phone: '', email: '' })
      onClose()
    },
    onError: (err) => toast.error(err.message || 'Failed to add vendor'),
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <Modal open={open} onClose={onClose} title="Add Vendor">
      <div className="space-y-4">
        <Input label="Vendor Name *" value={form.name} onChange={set('name')} placeholder="LKQ, Copart, etc." autoFocus />
        <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="(555) 555-5555" />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} placeholder="orders@vendor.com" />
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            onClick={() => {
              if (!form.name.trim()) { toast.error('Name is required'); return }
              mutation.mutate(form)
            }}
            className="flex-1"
          >
            Add Vendor
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function VendorSection() {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)

  const { data: vendors, isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: vendorsApi.list,
  })

  const deactivateMutation = useMutation({
    mutationFn: ({ id, active }) => vendorsApi.update(id, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendors'] }),
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: vendorsApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success('Vendor removed')
    },
    onError: (err) => toast.error(err.message || 'Cannot remove vendor in use'),
  })

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Store size={18} className="text-blue-400" />
          <h2 className="text-base font-bold text-gray-100">Vendors</h2>
          {vendors && (
            <Badge variant="default">{vendors.length}</Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={15} /> Add
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : vendors?.length === 0 ? (
        <EmptyState icon={Store} title="No vendors" description="Add your first vendor" />
      ) : (
        <div className="space-y-2">
          {vendors.map((v) => (
            <motion.div
              key={v.id}
              layout
              className="bg-gray-800/60 border border-gray-700/50 rounded-xl px-4 py-3.5 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-100 truncate">{v.name}</p>
                  {v.active === false && <Badge variant="gray">Inactive</Badge>}
                </div>
                {v.phone && <p className="text-xs text-gray-500 mt-0.5">{v.phone}</p>}
                {v.email && <p className="text-xs text-gray-500">{v.email}</p>}
              </div>

              {/* Toggle active */}
              <button
                onClick={() => deactivateMutation.mutate({ id: v.id, active: !(v.active !== false) })}
                className={`p-1.5 transition-colors rounded-lg ${
                  v.active !== false
                    ? 'text-emerald-400 hover:text-emerald-300'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
                title={v.active !== false ? 'Deactivate' : 'Activate'}
              >
                {v.active !== false ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
              </button>

              <button
                onClick={() => {
                  if (window.confirm(`Remove vendor "${v.name}"?`)) {
                    deleteMutation.mutate(v.id)
                  }
                }}
                className="p-1.5 text-gray-600 hover:text-red-400 transition-colors rounded-lg"
              >
                <Trash2 size={16} />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      <AddVendorModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

// ── Users ──────────────────────────────────────────────────────────────────────
function AddUserModal({ open, onClose }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'USER' })

  const mutation = useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User created')
      setForm({ name: '', username: '', password: '', role: 'USER' })
      onClose()
    },
    onError: (err) => toast.error(err.message || 'Failed to create user'),
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = () => {
    if (!form.username.trim() || !form.password.trim()) {
      toast.error('Username and password are required')
      return
    }
    mutation.mutate(form)
  }

  return (
    <Modal open={open} onClose={onClose} title="Add User">
      <div className="space-y-4">
        <Input label="Full Name" value={form.name} onChange={set('name')} placeholder="John Smith" />
        <Input label="Username *" value={form.username} onChange={set('username')} placeholder="jsmith" autoCapitalize="none" />
        <Input label="Password *" type="password" value={form.password} onChange={set('password')} placeholder="Min 6 characters" />
        <Select label="Role" value={form.role} onChange={set('role')}>
          <option value="USER">User (Staff)</option>
          <option value="ADMIN">Admin</option>
        </Select>
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={handleSubmit} className="flex-1">
            Create User
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function UsersSection() {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  })

  const deleteMutation = useMutation({
    mutationFn: usersApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User removed')
    },
    onError: (err) => toast.error(err.message || 'Failed to remove user'),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-blue-400" />
          <h2 className="text-base font-bold text-gray-100">Users</h2>
          {users && <Badge variant="default">{users.length}</Badge>}
        </div>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={15} /> Add
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : users?.length === 0 ? (
        <EmptyState icon={Users} title="No users" description="Add the first user account" />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <motion.div
              key={u.id}
              layout
              className="bg-gray-800/60 border border-gray-700/50 rounded-xl px-4 py-3.5 flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-white">
                  {(u.name || u.username)?.[0]?.toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-100 truncate">{u.name || u.username}</p>
                  <Badge variant={u.role === 'ADMIN' ? 'blue' : 'gray'}>
                    {u.role === 'ADMIN' ? 'Admin' : 'Staff'}
                  </Badge>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">@{u.username}</p>
              </div>
              <button
                onClick={() => {
                  if (window.confirm(`Remove user "${u.name || u.username}"?`)) {
                    deleteMutation.mutate(u.id)
                  }
                }}
                className="p-1.5 text-gray-600 hover:text-red-400 transition-colors rounded-lg"
              >
                <UserX size={16} />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

// ── Main Admin page ────────────────────────────────────────────────────────────
export default function Admin() {
  return (
    <div className="overflow-y-auto pb-28 px-4 py-5">
      <div className="max-w-lg mx-auto">
        <h1 className="text-xl font-bold text-gray-100 mb-6">Admin</h1>

        <VendorSection />

        <div className="border-t border-gray-700/50 pt-6">
          <UsersSection />
        </div>
      </div>
    </div>
  )
}
