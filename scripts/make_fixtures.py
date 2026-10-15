"""Create clearly labelled, nonempty document/audio transcript fixtures for the real import path."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

root=Path(__file__).resolve().parents[1]
out=root/'output'/'fixtures'
out.mkdir(parents=True,exist_ok=True)
c=canvas.Canvas(str(out/'research-fixture.pdf'),pagesize=A4)
sections=[('Research questions',[
 'This document is a realistic test fixture, not an investment report.',
 'Topic: supercapacitor supply chains and event-driven research.',
 'Question 1: What role does each supplier play in the value chain?',
 'Question 2: Which filing or report supports the claimed relationship?',
 'Question 3: Does a downstream order translate into supplier revenue?',
 'Record original sources, publication dates, units and reporting periods.',
 'Separate facts from hypotheses. Keep counter-evidence for later review.'
]),('Evidence and review',[
 'A new order is an event. Its business impact remains a hypothesis.',
 'Compare the order date, delivery period, and revenue recognition date.',
 'A stock split changes the price basis without changing business value.',
 'Use raw closing prices and explicitly labelled adjustment methods.',
 'Retain earlier observations when a financial series is revised.',
 'Schedule a review and state which evidence could reject the hypothesis.'
]),('English shadowing practice',[
 'Could you explain the supply chain?',
 'Let us start with the raw materials.',
 'What changed in the latest report?',
 'We need more evidence before reaching a conclusion.',
 'These original sentences may be used for local application testing.'
])]
for page,(title,lines) in enumerate(sections,1):
 c.setFillColorRGB(.20,.35,.27);c.setFont('Helvetica-Bold',24);c.drawString(52,778,title)
 c.setFont('Helvetica',10);c.setFillColorRGB(.45,.5,.42);c.drawString(52,753,'CETRINW | EXPLICITLY LABELLED REALISTIC FIXTURE')
 c.setFont('Helvetica',12);c.setFillColorRGB(.2,.23,.2)
 for i,line in enumerate(lines):c.drawString(52,697-i*32,line)
 c.setFont('Helvetica',10);c.drawString(52,45,f'Page {page} / 3 - authored for software verification')
 c.showPage()
c.save()
text='Could you explain the supply chain?\nLet us start with the raw materials.\nWhat changed in the latest report?\nWe need more evidence before reaching a conclusion.'
(out/'original-dialogue.txt').write_text(text)
(out/'original-dialogue.srt').write_text('1\n00:00:00,000 --> 00:00:03,000\nCould you explain the supply chain?\n\n2\n00:00:03,000 --> 00:00:06,500\nLet us start with the raw materials.\n\n3\n00:00:06,500 --> 00:00:09,500\nWhat changed in the latest report?\n\n4\n00:00:09,500 --> 00:00:14,000\nWe need more evidence before reaching a conclusion.\n')
print(out)
