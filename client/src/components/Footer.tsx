import { Link } from "wouter";
import { Github, Linkedin, Mail, Download } from "lucide-react";

const Footer = () => {
  return (
    <footer className="bg-neutral-900 text-white py-16 px-4">
      <div className="container mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          <div>
            <h3 className="text-2xl font-bold mb-6">Mehyar Swelim</h3>
            <p className="text-neutral-300 mb-6">
              Staff Software Engineer focused on AI systems, cloud architecture, DevOps, full-stack platforms, and technical leadership.
            </p>
            <div className="flex space-x-4">
              <a href="https://www.linkedin.com/in/mehyarswelim" target="_blank" rel="noopener noreferrer" className="w-10 h-10 bg-neutral-800 hover:bg-primary rounded-full flex items-center justify-center transition-colors" aria-label="LinkedIn">
                <Linkedin size={18} />
              </a>
              <a href="mailto:mrswelim@gmail.com" className="w-10 h-10 bg-neutral-800 hover:bg-primary rounded-full flex items-center justify-center transition-colors" aria-label="Email">
                <Mail size={18} />
              </a>
              <a href="https://github.com/mehyar-us" target="_blank" rel="noopener noreferrer" className="w-10 h-10 bg-neutral-800 hover:bg-primary rounded-full flex items-center justify-center transition-colors" aria-label="GitHub">
                <Github size={18} />
              </a>
              <a href="/Mehyar-Swelim-Resume.txt" download className="w-10 h-10 bg-neutral-800 hover:bg-primary rounded-full flex items-center justify-center transition-colors" aria-label="Resume">
                <Download size={18} />
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Hiring Fit</h4>
            <ul className="space-y-3 text-neutral-300">
              <li>Staff Software Engineer</li>
              <li>Principal Software Engineer</li>
              <li>AI Platform / LLM Engineer</li>
              <li>Cloud / Solutions Architect</li>
              <li>Hands-on Engineering Lead</li>
            </ul>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Site</h4>
            <ul className="space-y-3">
              <li><Link href="/"><a className="text-neutral-300 hover:text-white transition-colors">Home</a></Link></li>
              <li><Link href="/portfolio"><a className="text-neutral-300 hover:text-white transition-colors">Proof of Work</a></Link></li>
              <li><Link href="/services"><a className="text-neutral-300 hover:text-white transition-colors">Capabilities</a></Link></li>
              <li><Link href="/about"><a className="text-neutral-300 hover:text-white transition-colors">About</a></Link></li>
              <li><Link href="/contact"><a className="text-neutral-300 hover:text-white transition-colors">Contact</a></Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-neutral-800 flex flex-col md:flex-row justify-between items-center">
          <p className="text-neutral-400">© {new Date().getFullYear()} Mehyar Swelim. All rights reserved.</p>
          <p className="text-neutral-500 mt-4 md:mt-0">Brooklyn, NY · Remote / Hybrid</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
