#!/usr/bin/env python3
"""Build the unsigned Apple Shortcuts source for a specific Shots origin."""
import argparse
import pathlib
import plistlib
from urllib.parse import urlparse

parser=argparse.ArgumentParser()
parser.add_argument('--origin',default='https://shots.playbookmedia.io')
parser.add_argument('--output',default=str(pathlib.Path(__file__).with_name('Create Shots Draft.shortcut')))
args=parser.parse_args()
u=urlparse(args.origin)
if u.scheme!='https' or not u.hostname or u.username or u.password or u.path not in ['', '/'] or u.query or u.fragment:
    parser.error('Use an HTTPS origin without a path, query, or credentials.')
encoded='5EB18280-33F8-4C66-8310-C45086BC38CB'
prefix=args.origin.rstrip('/')+'/?new='
shortcut={
 'WFWorkflowClientVersion':'3036.0.4',
 'WFWorkflowClientRelease':'18.0',
 'WFWorkflowMinimumClientVersion':900,
 'WFWorkflowName':'Create Shots Draft',
 'WFWorkflowIcon':{'WFWorkflowIconStartColor':4282601983,'WFWorkflowIconGlyphNumber':59511},
 'WFWorkflowTypes':[],
 'WFWorkflowInputContentItemClasses':[],
 'WFWorkflowActions':[
  {'WFWorkflowActionIdentifier':'is.workflow.actions.ask','WFWorkflowActionParameters':{'WFAskActionPrompt':'Draft text (separate posts with --- on its own line)','WFInputType':'Text','WFAskActionDefaultAnswer':''}},
  {'WFWorkflowActionIdentifier':'is.workflow.actions.urlencode','WFWorkflowActionParameters':{'WFEncodeMode':'Encode','UUID':encoded}},
  {'WFWorkflowActionIdentifier':'is.workflow.actions.gettext','WFWorkflowActionParameters':{'WFTextActionText':{'WFSerializationType':'WFTextTokenString','Value':{'string':prefix+'\ufffc','attachmentsByRange':{'{%d, 1}'%len(prefix):{'Type':'ActionOutput','OutputUUID':encoded,'OutputName':'URL Encoded Text'}}}}}},
  {'WFWorkflowActionIdentifier':'is.workflow.actions.openurl','WFWorkflowActionParameters':{}},
 ],
}
with open(args.output,'wb') as f:plistlib.dump(shortcut,f,fmt=plistlib.FMT_XML,sort_keys=False)
print('Wrote unsigned Shortcut:',args.output)
