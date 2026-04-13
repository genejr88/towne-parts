import { motion } from 'framer-motion'
import Header from './Header'
import BottomNav from './BottomNav'

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

export default function AppLayout({ children }) {
  return (
    <div className="min-h-dvh bg-gray-950 text-gray-100 font-sans flex flex-col">
      <Header />

      <main className="flex-1 relative overflow-hidden">
        <motion.div
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="h-full"
        >
          {children}
        </motion.div>
      </main>

      <BottomNav />
    </div>
  )
}
