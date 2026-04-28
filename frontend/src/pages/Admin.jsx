import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Store, Users, Plus, Trash2, UserX, ToggleLeft, ToggleRight, Star, Pencil, KeyRound, Eye, EyeOff } from 'lucide-react'
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
function VendorModal({ open, onClose, vendor = null }) {
  const queryClient = useQueryClient()
  const isEdit = !!vendor

  const [form, setForm] = useState(
    vendor
      ? { name: vendor.name, phone: vendor.phone || '', email: vendor.email || '', make: vendor.make || '' }
      : { name: '', phone: '', email: '', make: '' }
  )

  // Reset form when vendor changes (switching between edit targets)
  const resetForm = (v) => {
    if (v) {
      setForm({ name: v.name, phone: v.phone || '', email: v.email || '', make: v.make || '' })
    } else {
      setForm({ name: '', phone: '', email: '', make: '' })
    }
  }

  // Sync when vendor prop changes
  const prevVendorId = vendor?.id
  if (vendor?.id !== prevVendorId) resetForm(vendor)

  const mutation = useMutation({
    mutationFn: isEdit
      ? (data) => vendorsApi.update(vendor.id, data)
      : vendorsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success(isEdit ? 'Vendor updated' : 'Vendor added')
      if (!isEdit) setForm({ name: '', phone: '', email: '', make: '' })
      onClose()
    },
    onError: (err) => toast.error(err.message || 'Failed to save vendor'),
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = () => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    mutation.mutate(form)
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Vendor' : 'Add Vendor'}>
      <div className="space-y-4">
        <Input label="Vendor Name *" value={form.name} onChange={set('name')} placeholder="BMW of Bridgeport, LKQ, etc." autoFocus />
        <Input label="Vehicle Make (for auto-select)" value={form.make} onChange={set('make')} placeholder="BMW, Toyota, Ford…" />
        <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="(555) 555-5555" />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} placeholder="orders@vendor.com" />
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            onClick={handleSubmit}
            className="flex-1"
          >
            {isEdit ? 'Save Changes' : 'Add Vendor'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function VendorSection() {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editVendor, setEditVendor] = useState(null)

  const { data: vendors, isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => vendorsApi.list({ all: true }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }) => vendorsApi.update(id, data),
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
          {vendors && <Badge variant="default">{vendors.length}</Badge>}
        </div>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={15} /> Add
        </Button>
      </div>

      <p className="text-xs text-gray-500 mb-3">
        ★ = default vendor — auto-selected when creating a new RO
      </p>

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
              className={`border rounded-xl px-4 py-3.5 flex items-center gap-3 transition-colors ${
                v.isDefault
                  ? 'bg-amber-950/30 border-amber-500/40'
                  : 'bg-gray-800/60 border-gray-700/50'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-gray-100 truncate">{v.name}</p>
                  {v.isDefault && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300">
                      Default
                    </span>
                  )}
                  {!v.isActive && <Badge variant="gray">Inactive</Badge>}
                </div>
                {v.make && (
                  <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 mt-0.5">
                    {v.make}
                  </span>
                )}
                {v.phone && <p className="text-xs text-gray-500 mt-0.5">{v.phone}</p>}
                {v.email && <p className="text-xs text-gray-500">{v.email}</p>}
              </div>

              {/* Edit */}
              <button
                onClick={() => setEditVendor(v)}
                className="p-1.5 text-gray-600 hover:text-blue-400 transition-colors rounded-lg"
                title="Edit vendor"
              >
                <Pencil size={15} />
              </button>

              {/* Star = set as default */}
              <button
                onClick={() => updateMutation.mutate({ id: v.id, isDefault: !v.isDefault })}
                className={`p-1.5 transition-colors rounded-lg ${
                  v.isDefault
                    ? 'text-amber-400 hover:text-amber-300'
                    : 'text-gray-600 hover:text-amber-400'
                }`}
                title={v.isDefault ? 'Remove default' : 'Set as default'}
              >
                <Star size={16} className={v.isDefault ? 'fill-amber-400' : ''} />
              </button>

              {/* Toggle active */}
              <button
                onClick={() => updateMutation.mutate({ id: v.id, isActive: !v.isActive })}
                className={`p-1.5 transition-colors rounded-lg ${
                  v.isActive
                    ? 'text-emerald-400 hover:text-emerald-300'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
                title={v.isActive ? 'Deactivate' : 'Activate'}
              >
                {v.isActive ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
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

      {/* Add modal */}
      <VendorModal open={addOpen} onClose={() => setAddOpen(false)} />

      {/* Edit modal */}
      <AnimatePresence>
        {editVendor && (
          <VendorModal
            key={editVendor.id}
            open={!!editVendor}
            vendor={editVendor}
            onClose={() => setEditVendor(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Users ──────────────────────────────────────────────────────────────────────
function UserModal({ open, onClose, user = null }) {
  const queryClient = useQueryClient()
  const isEdit = !!user

  const [form, setForm] = useState(
    user
      ? { name: user.name || '', username: user.username, role: user.role, newPassword: '', confirmPassword: '' }
      : { name: '', username: '', password: '', role: 'USER' }
  )
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const mutation = useMutation({
    mutationFn: isEdit
      ? (data) => usersApi.update(user.id, data)
      : usersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(isEdit ? 'User updated' : 'User created')
      if (!isEdit) setForm({ name: '', username: '', password: '', role: 'USER' })
      onClose()
    },
    onError: (err) => toast.error(err.message || 'Failed to save user'),
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = () => {
    if (isEdit) {
      // Validate password change if provided
      if (form.newPassword) {
        if (form.newPassword.length < 6) { toast.error('Password must be at least 6 characters'); return }
        if (form.newPassword !== form.confirmPassword) { toast.error('Passwords do not match'); return }
      }
      const payload = {
        name: form.name,
        username: form.username,
        role: form.role,
      }
      if (form.newPassword) payload.password = form.newPassword
      mutation.mutate(payload)
    } else {
      if (!form.username.trim() || !form.password.trim()) {
        toast.error('Username and password are required')
        return
      }
      if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return }
      mutation.mutate(form)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit ${user.name || user.username}` : 'Add User'}>
      <div className="space-y-4">
        <Input label="Full Name" value={form.name} onChange={set('name')} placeholder="John Smith" autoFocus={!isEdit} />
        <Input
          label="Username *"
          value={form.username}
          onChange={set('username')}
          placeholder="jsmith"
          autoCapitalize="none"
          autoFocus={isEdit}
        />
        <Select label="Role" value={form.role} onChange={set('role')}>
          <option value="USER">User (Staff)</option>
          <option value="ADMIN">Admin</option>
        </Select>

        {isEdit ? (
          <>
            <div className="border-t border-gray-700/50 pt-4">
              <p className="text-xs text-gray-500 mb-3">Reset password — leave blank to keep current</p>
              <div className="space-y-3">
                <div className="relative">
                  <Input
                    label="New Password"
                    type={showPw ? 'text' : 'password'}
                    value={form.newPassword}
                    onChange={set('newPassword')}
                    placeholder="Min 6 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-[34px] text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {form.newPassword && (
                  <div className="relative">
                    <Input
                      label="Confirm Password"
                      type={showConfirm ? 'text' : 'password'}
                      value={form.confirmPassword}
                      onChange={set('confirmPassword')}
                      placeholder="Repeat new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-[34px] text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="relative">
            <Input
              label="Password *"
              type={showPw ? 'text' : 'password'}
              value={form.password}
              onChange={set('password')}
              placeholder="Min 6 characters"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-[34px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={handleSubmit} className="flex-1">
            {isEdit ? 'Save Changes' : 'Create User'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function UsersSection() {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editUser, setEditUser] = useState(null)

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

              {/* Edit / reset password */}
              <button
                onClick={() => setEditUser(u)}
                className="p-1.5 text-gray-600 hover:text-blue-400 transition-colors rounded-lg"
                title="Edit user / reset password"
              >
                <Pencil size={15} />
              </button>

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

      <UserModal open={addOpen} onClose={() => setAddOpen(false)} />

      <AnimatePresence>
        {editUser && (
          <UserModal
            key={editUser.id}
            open={!!editUser}
            user={editUser}
            onClose={() => setEditUser(null)}
          />
        )}
      </AnimatePresence>
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
