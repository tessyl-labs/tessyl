import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  ArrowRightIcon,
  ArrowUpIcon,
  BookOpenIcon,
  BookmarkIcon,
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  Clock3Icon,
  CopyIcon,
  EllipsisIcon,
  FilePlus2Icon,
  FolderOpenIcon,
  HistoryIcon,
  HomeIcon,
  LibraryBigIcon,
  LinkIcon,
  MenuIcon,
  MessageCircleQuestionIcon,
  NetworkIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  StarIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import "./style.css"

type Article = {
  id: string
  eyebrow: string
  title: string
  summary: string
  updated: string
  read: string
  confidence: number
  contributors: string
}

const articles: Article[] = [
  {
    id: "agentic-librarianship",
    eyebrow: "Field guide · Knowledge systems",
    title: "Agentic librarianship",
    summary: "A practice for cultivating shared knowledge with autonomous agents that research, connect, revise, and steward information alongside people.",
    updated: "18 minutes ago",
    read: "8 min read",
    confidence: 94,
    contributors: "Mira + 6 contributors",
  },
  {
    id: "knowledge-gardens",
    eyebrow: "Concept · Information ecology",
    title: "Knowledge gardens",
    summary: "Digital spaces that favor continuous cultivation, meaningful links, and visible evolution over one-time publication.",
    updated: "Yesterday",
    read: "5 min read",
    confidence: 89,
    contributors: "4 contributors",
  },
  {
    id: "source-provenance",
    eyebrow: "Standard · Trust & safety",
    title: "Source provenance",
    summary: "A practical standard for showing where a claim came from, how it changed, and why it should be trusted.",
    updated: "3 days ago",
    read: "6 min read",
    confidence: 97,
    contributors: "Mira + 9 contributors",
  },
]

const collections = [
  { name: "Ways of working", count: 24, tone: "plum" },
  { name: "Knowledge systems", count: 18, tone: "moss" },
  { name: "Product craft", count: 31, tone: "ochre" },
  { name: "Research notes", count: 16, tone: "blue" },
]

function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ArticleBody({ article }: { article: Article }) {
  if (article.id === "knowledge-gardens") {
    return (
      <div className="article-body">
        <p className="lede">A knowledge garden is grown through attention. Notes begin as seeds, gather context through use, and become more useful as their relationships to other ideas are made visible.</p>
        <h2 id="principles">Gardens and streams</h2>
        <p>Streams privilege recency; gardens privilege accumulated understanding. A healthy knowledge system needs both: a stream to notice what is happening and a garden to remember what it means.</p>
        <Card size="sm" className="article-callout">
          <CardHeader><CardTitle>In practice</CardTitle><CardDescription>Mira revisits frequently accessed seeds, proposes connections, and asks a human steward before promoting them to evergreen articles.</CardDescription></CardHeader>
        </Card>
        <h2 id="stewardship">Cultivation signals</h2>
        <p>Revisits, citations, unresolved questions, and incoming links all suggest that a note deserves attention. None is sufficient on its own. The librarian uses them as invitations to investigate.</p>
      </div>
    )
  }

  if (article.id === "source-provenance") {
    return (
      <div className="article-body">
        <p className="lede">Provenance is the memory of a claim. It records the path from observation to interpretation so confidence can be earned, questioned, and revised.</p>
        <h2 id="principles">What a source trail contains</h2>
        <p>A useful trail identifies the source, the relevant passage or data, who introduced it, and the transformations applied along the way.</p>
        <div className="principle-grid">
          {[['A', 'Origin', 'Where the information first entered the commons.'], ['B', 'Interpretation', 'How editors understood or transformed it.'], ['C', 'Confidence', 'What evidence supports the present claim.'], ['D', 'Revision', 'When and why the understanding changed.']].map(([number, title, description]) => (
            <Card size="sm" key={number}><CardHeader><Badge variant="outline">{number}</Badge><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader></Card>
          ))}
        </div>
        <h2 id="stewardship">Trust is inspectable</h2>
        <p>A confidence score can help readers orient themselves, but it never replaces a visible chain of evidence. Every important claim should remain open to inspection.</p>
      </div>
    )
  }

  return (
    <div className="article-body">
      <p className="lede">Agentic librarianship treats a knowledge base as a living commons, not a cabinet of finished documents. Its librarian is an active participant: continuously noticing gaps, tracing contradictions, and proposing useful connections.</p>
      <Card size="sm" className="mira-note">
        <CardHeader><div className="note-icon"><SparklesIcon /></div><CardTitle>Mira’s note</CardTitle><CardDescription>I merged three overlapping definitions and preserved the original points of disagreement below.</CardDescription><CardAction><Button variant="link" size="xs" onClick={() => toast.info("Revision history would open here")}>View edit</Button></CardAction></CardHeader>
      </Card>
      <h2 id="principles">Core principles</h2>
      <p>The librarian’s role is to increase the reliability and navigability of the collection without erasing its human texture. That calls for four complementary habits:</p>
      <div className="principle-grid">
        {[['01', 'Observe', 'Watch how knowledge is used, where readers stall, and which questions recur.'], ['02', 'Connect', 'Reveal relationships between ideas instead of forcing everything into one taxonomy.'], ['03', 'Challenge', 'Surface stale claims, thin evidence, and genuine disagreement for human review.'], ['04', 'Remember', 'Keep an intelligible trail of how an article changed, and why.']].map(([number, title, description]) => (
          <Card size="sm" key={number}><CardHeader><Badge variant="outline">{number}</Badge><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader></Card>
        ))}
      </div>
      <h2 id="stewardship">Stewardship, not authorship</h2>
      <p>An agentic librarian may draft, summarize, and restructure, but its deeper responsibility is stewardship. Every intervention should be legible: readers can inspect the sources, understand the rationale, and restore an earlier interpretation.</p>
      <blockquote>“The best library does not merely answer the question you asked. It helps you discover the question beside it.”<cite>Working note, Knowledge Garden group</cite></blockquote>
      <h2 id="rhythm">The maintenance rhythm</h2>
      <p>Good maintenance happens in small, reversible loops. The librarian observes activity, composes a proposed change, tests it against the collection’s standards, and asks for judgment only where judgment is truly needed.</p>
      <ol className="steps">
        {[['Scan', 'Find articles that are stale, isolated, duplicated, or suddenly popular.'], ['Investigate', 'Compare sources, activity, and neighboring concepts.'], ['Propose', 'Prepare a focused, reversible change with a plain-language rationale.']].map(([title, description], index) => <li key={title}><Badge variant="outline">{index + 1}</Badge><div><strong>{title}</strong><p>{description}</p></div></li>)}
      </ol>
    </div>
  )
}

function LibrarianPanel({ article, collapsed, onCollapse, onSelectArticle }: { article: Article; collapsed: boolean; onCollapse: () => void; onSelectArticle: (article: Article) => void }) {
  const [question, setQuestion] = useState("")
  const [queued, setQueued] = useState<string[]>([])

  function toggleQueue(item: string) {
    setQueued((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])
    toast.success(queued.includes(item) ? "Removed from review queue" : "Added to review queue")
  }

  function askMira() {
    if (!question.trim()) return
    toast.loading("Mira is tracing the relevant ideas…", { duration: 1800 })
    setQuestion("")
  }

  return (
    <aside className={`librarian ${collapsed ? "collapsed" : ""}`}>
      <div className="librarian-header">
        <Avatar size="lg"><AvatarFallback className="mira-fallback"><SparklesIcon /></AvatarFallback><AvatarBadge /></Avatar>
        <div><h2>Mira</h2><p><span className="status-dot" /> Librarian · Active</p></div>
        <IconButton label={collapsed ? "Open librarian" : "Close librarian"} onClick={onCollapse}>{collapsed ? <BotIcon /> : <XIcon />}</IconButton>
      </div>
      <Tabs defaultValue="brief" className="librarian-tabs-root">
        <TabsList variant="line" className="librarian-tabs"><TabsTrigger value="brief">Brief</TabsTrigger><TabsTrigger value="activity">Activity <Badge variant="secondary">3</Badge></TabsTrigger></TabsList>
        <ScrollArea className="librarian-scroll">
          <TabsContent value="brief" className="librarian-content">
            <Card size="sm" className="brief-card"><CardHeader><Badge variant="outline">Article brief</Badge><CardTitle>Here’s what matters</CardTitle><CardDescription>This article frames librarianship as ongoing stewardship. It’s strongest when explaining the maintenance loop and where human judgment remains essential.</CardDescription></CardHeader></Card>
            <div className="confidence-block"><Progress value={article.confidence}><ProgressLabel>Confidence</ProgressLabel><ProgressValue /></Progress><p>Based on 12 sources and 4 recent reviews</p></div>
            <Separator />
            <div className="section-heading"><span>Needs attention</span><Badge variant="secondary">2</Badge></div>
            <Card size="sm" className={queued.includes("stale") ? "attention-card queued" : "attention-card"} onClick={() => toggleQueue("stale")}><CardHeader><div className="attention-icon amber"><CircleAlertIcon /></div><CardTitle>One claim may be stale</CardTitle><CardDescription>The adoption figure references a 2024 survey.</CardDescription></CardHeader><CardFooter><span>{queued.includes("stale") ? "In review queue" : "Review evidence"}</span><ChevronRightIcon /></CardFooter></Card>
            <Card size="sm" className={queued.includes("emerging") ? "attention-card queued" : "attention-card"} onClick={() => toggleQueue("emerging")}><CardHeader><div className="attention-icon violet"><NetworkIcon /></div><CardTitle>A nearby idea is emerging</CardTitle><CardDescription>“Institutional memory” has 3 new notes.</CardDescription></CardHeader><CardFooter><span>{queued.includes("emerging") ? "In review queue" : "Compare concepts"}</span><ChevronRightIcon /></CardFooter></Card>
            <div className="section-heading"><span>Related paths</span><Button variant="link" size="xs">See all</Button></div>
            <div className="related-list">{articles.filter((item) => item.id !== article.id).slice(0, 2).map((item) => <Button variant="ghost" className="related-item" key={item.id} onClick={() => onSelectArticle(item)}><span className="dot moss" /><span><strong>{item.title}</strong><small>{item.eyebrow.split(" · ")[0]} · {item.read}</small></span><Badge variant="outline">{item.confidence - 2}%</Badge></Button>)}</div>
          </TabsContent>
          <TabsContent value="activity" className="librarian-content activity-feed">
            {[['Connected 2 articles', 'Linked “Collective memory” and “Knowledge gardens” to this article.', '18 min ago', <LinkIcon />], ['Clarified a definition', 'Reconciled overlapping passages and kept a note about the disagreement.', '42 min ago', <FilePlus2Icon />], ['Checked 7 sources', 'All citations are reachable. One is scheduled for review in 14 days.', 'Today, 9:14 AM', <CheckIcon />]].map(([title, description, time, icon]) => <div className="activity-item" key={title as string}><span className="activity-icon">{icon}</span><div><strong>{title}</strong><p>{description}</p><time>{time}</time></div></div>)}
          </TabsContent>
        </ScrollArea>
      </Tabs>
      <div className="ask">
        <div className="suggestions"><Button variant="outline" size="xs" onClick={() => setQuestion("What should I read next?")}>What should I read next?</Button><Button variant="outline" size="xs" onClick={() => setQuestion("Why was this changed?")}>Why was this changed?</Button></div>
        <InputGroup className="ask-box"><InputGroupTextarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask Mira about this article…" rows={1} /><InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" variant="default" onClick={askMira} aria-label="Send question"><ArrowUpIcon /></InputGroupButton></InputGroupAddon></InputGroup>
        <p>Mira can make mistakes. Check important sources.</p>
      </div>
    </aside>
  )
}

function App() {
  const [article, setArticle] = useState(articles[0])
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [librarianCollapsed, setLibrarianCollapsed] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [])

  function selectArticle(next: Article) {
    setArticle(next)
    setSearchOpen(false)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <TooltipProvider>
      <div className="shell">
        <header className="topbar">
          <Button variant="ghost" className="brand" onClick={() => selectArticle(articles[0])}><span className="brand-mark">S</span><span>Scribe</span></Button>
          <Button variant="outline" className="search-trigger" onClick={() => setSearchOpen(true)}><SearchIcon data-icon="inline-start" /><span>Search the commons…</span><kbd>⌘ K</kbd></Button>
          <div className="top-actions">
            <IconButton label="Open navigation" onClick={() => setMobileNav((open) => !open)}><MenuIcon /></IconButton>
            <AvatarGroup className="team-avatars"><Avatar size="sm"><AvatarFallback>ML</AvatarFallback></Avatar><Avatar size="sm"><AvatarFallback>AK</AvatarFallback></Avatar><AvatarGroupCount>+4</AvatarGroupCount></AvatarGroup>
            <Dialog>
              <DialogTrigger render={<Button />}><PlusIcon data-icon="inline-start" /> New article</DialogTrigger>
              <DialogContent className="new-article-dialog">
                <DialogHeader><div className="dialog-icon"><SparklesIcon /></div><DialogTitle>Start with a question</DialogTitle><DialogDescription>Give Mira a topic or rough thought. She’ll find related work and prepare a first draft for you.</DialogDescription></DialogHeader>
                <FieldGroup><Field><FieldLabel htmlFor="article-seed">Topic or question</FieldLabel><Textarea id="article-seed" placeholder="How should we think about institutional memory?" /><FieldDescription>You can refine sources and structure before anything is published.</FieldDescription></Field></FieldGroup>
                <DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><DialogClose render={<Button onClick={() => toast.success("Mira is preparing your first draft")} />}><SparklesIcon data-icon="inline-start" />Draft with Mira</DialogClose></DialogFooter>
              </DialogContent>
            </Dialog>
            <Avatar><AvatarFallback>DR</AvatarFallback></Avatar>
          </div>
        </header>
        <div className="workspace">
          <nav className={`sidebar ${mobileNav ? "open" : ""}`} aria-label="Knowledge navigation">
            <div className="nav-group"><p className="nav-label">Workspace</p><Button variant="secondary" className="nav-item active"><HomeIcon />Home</Button><Button variant="ghost" className="nav-item"><Clock3Icon />Recent<Badge variant="secondary">12</Badge></Button><Button variant="ghost" className="nav-item"><StarIcon />Saved</Button><Button variant="ghost" className="nav-item"><BookOpenIcon />Following</Button></div>
            <div className="nav-group"><div className="nav-title"><p className="nav-label">Collections</p><IconButton label="Add collection"><PlusIcon /></IconButton></div>{collections.map((collection) => <Button variant="ghost" className="nav-item" key={collection.name}><span className={`dot ${collection.tone}`} />{collection.name}<Badge variant="outline">{collection.count}</Badge></Button>)}</div>
            <div className="nav-group grow"><p className="nav-label">In this article</p><a href="#principles">Core principles</a><a href="#stewardship">Stewardship, not authorship</a><a href="#rhythm">The maintenance rhythm</a></div>
            <Card size="sm" className="library-health"><CardHeader><CardTitle>Library health</CardTitle><CardAction><Badge variant="outline">Good</Badge></CardAction></CardHeader><CardContent><Progress value={84} /><p>84% of articles reviewed this quarter</p></CardContent></Card>
          </nav>
          <main className="main">
            <section className="article-toolbar"><div className="breadcrumbs"><Button variant="link" size="xs">Knowledge systems</Button><span>/</span><span>Field guides</span></div><div><IconButton label={saved ? "Remove from saved" : "Save article"} onClick={() => { setSaved((value) => !value); toast.success(saved ? "Removed from saved" : "Saved to your reading list") }}>{saved ? <BookmarkIcon fill="currentColor" /> : <BookmarkIcon />}</IconButton><IconButton label="Copy link" onClick={() => { void navigator.clipboard?.writeText(window.location.href); toast.success("Article link copied") }}><CopyIcon /></IconButton><IconButton label="More actions" onClick={() => toast.info("More article actions are coming soon")}><EllipsisIcon /></IconButton></div></section>
            <article className="article">
              <header className="article-heading"><Badge variant="outline">{article.eyebrow}</Badge><h1>{article.title}</h1><p className="summary">{article.summary}</p><div className="article-meta"><AvatarGroup><Avatar size="sm"><AvatarFallback>M</AvatarFallback></Avatar><Avatar size="sm"><AvatarFallback>AK</AvatarFallback></Avatar><Avatar size="sm"><AvatarFallback>JL</AvatarFallback></Avatar></AvatarGroup><span>{article.contributors}</span><span className="meta-dot" /><span>Updated {article.updated}</span><span className="meta-dot" /><span>{article.read}</span></div></header>
              <Separator />
              <ArticleBody article={article} />
              <footer className="article-footer"><div><span>Was this useful?</span><Button variant="outline" size="xs" onClick={() => toast.success("Thanks — Mira will use that feedback")}>Yes</Button><Button variant="outline" size="xs" onClick={() => toast("Thanks — tell Mira what was missing")}>Not quite</Button></div><Button variant="link" size="xs" onClick={() => toast.info("Revision history would open here")}><HistoryIcon data-icon="inline-start" />See full revision history</Button></footer>
            </article>
          </main>
          <LibrarianPanel article={article} collapsed={librarianCollapsed} onCollapse={() => setLibrarianCollapsed((value) => !value)} onSelectArticle={selectArticle} />
        </div>
      </div>

      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen} title="Search the knowledge commons" description="Find articles or ask Mira a question.">
        <CommandInput placeholder="Search articles, people, or ask Mira…" />
        <CommandList><CommandEmpty>No exact matches. Ask Mira to investigate it.</CommandEmpty><CommandGroup heading="Jump back in">{articles.map((item) => <CommandItem key={item.id} value={`${item.title} ${item.summary}`} onSelect={() => selectArticle(item)}><span className="result-icon">{item.title.charAt(0)}</span><span className="command-copy"><strong>{item.title}</strong><small>{item.eyebrow}</small></span><CommandShortcut>{item.read}</CommandShortcut></CommandItem>)}</CommandGroup><CommandGroup heading="Ask Mira"><CommandItem onSelect={() => { setSearchOpen(false); toast.loading("Mira is surveying the commons…", { duration: 1800 }) }}><MessageCircleQuestionIcon /><span>Investigate a new question</span><CommandShortcut>↵</CommandShortcut></CommandItem></CommandGroup></CommandList>
      </CommandDialog>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}

createRoot(document.getElementById("app")!).render(<App />)
